const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const crypto = require('crypto');
const pdf = require('pdf-extraction');
const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');
const { QdrantClient } = require('@qdrant/js-client-rest');

// 1. Load environment variables FIRST
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// 2. Initialize Gemini SDK
const cleanKey = (str) => (str || '').replace(/['"]/g, '').trim();
const ai = new GoogleGenAI({ apiKey: cleanKey(process.env.GEMINI_API_KEY) });

// 3. Initialize Supabase & Qdrant Clients
const supabase = createClient(
  cleanKey(process.env.SUPABASE_URL),
  cleanKey(process.env.SUPABASE_KEY)
);

const qdrant = new QdrantClient({
  url: cleanKey(process.env.QDRANT_URL),
  apiKey: cleanKey(process.env.QDRANT_API_KEY)
});

const COLLECTION_NAME = 'document_chunks';

// Ensure Qdrant collection exists with 768-dim Cosine vectors
async function ensureQdrantCollection(vectorSize = 768) {
  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === COLLECTION_NAME);

  if (!exists) {
    console.log(`Creating Qdrant collection: ${COLLECTION_NAME} (${vectorSize} dims)...`);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine'
      }
    });
    // Create a Payload Index so Qdrant allows us to filter by document_id
    console.log(`Creating Payload Index for document_id...`);
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: 'document_id',
      field_schema: 'keyword' 
    });
  }
}

// Configure Multer for in-memory PDF uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Utility: Sliding-Window Chunking
function createChunks(text, chunkSize = 1000, overlap = 150) {
  const chunks = [];
  let startIndex = 0;
  while (startIndex < text.length) {
    chunks.push(text.slice(startIndex, startIndex + chunkSize));
    startIndex += (chunkSize - overlap);
  }
  return chunks;
}

// Document Upload, Embedding & Dual-Database Persistence Endpoint
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    console.log('Processing file:', req.file.originalname);

    // 1. Extract text from PDF buffer
    const pdfData = await pdf(req.file.buffer);
    const extractedText = pdfData.text.trim();

    if (extractedText.length < 50) {
      return res.status(422).json({
        error: 'No readable text found. Please upload a text-based PDF.'
      });
    }

    // 2. Chop text into overlapping chunks
    const chunks = createChunks(extractedText, 1000, 150);
    console.log(`Document split into ${chunks.length} chunks. Generating embeddings...`);

    // 3. Generate 768-dimension Vector Embeddings using Gemini
    const chunkData = await Promise.all(
      chunks.map(async (chunk, index) => {
        const response = await ai.models.embedContent({
          model: 'gemini-embedding-001',
          contents: chunk,
          config: { outputDimensionality: 768 }
        });

        return {
          chunkIndex: index,
          text: chunk,
          embedding: response.embeddings[0].values
        };
      })
    );

    console.log(`✅ Generated embeddings for ${chunkData.length} chunks! Saving to databases...`);

    // 4. Save Contract Metadata to Supabase (PostgreSQL)
    const { data: docRecord, error: supabaseError } = await supabase
      .from('documents')
      .insert({
        file_name: req.file.originalname,
        page_count: pdfData.numpages,
        chunk_count: chunkData.length,
        status: 'embedded'
      })
      .select()
      .single();

    if (supabaseError) {
      throw new Error(`Supabase Insert Error: ${supabaseError.message}`);
    }

    // 5. Save Chunks + Vectors to Qdrant Cloud
    const vectorDim = chunkData[0].embedding.length;
    await ensureQdrantCollection(vectorDim);

    const points = chunkData.map((item) => ({
      id: crypto.randomUUID(),
      vector: item.embedding,
      payload: {
        document_id: docRecord.id,
        file_name: req.file.originalname,
        chunk_index: item.chunkIndex,
        text: item.text
      }
    }));

    await qdrant.upsert(COLLECTION_NAME, {
      wait: true,
      points
    });

    console.log(`🎉 Saved Document ${docRecord.id} to Supabase & ${points.length} vectors to Qdrant!`);

    // 6. Return full confirmation to React frontend
    res.status(200).json({
      message: 'PDF parsed, embedded, and saved to Supabase & Qdrant!',
      documentId: docRecord.id,
      fileName: req.file.originalname,
      pageCount: pdfData.numpages,
      chunkCount: chunkData.length,
      embeddingDimensions: vectorDim,
      preview: chunkData[0].text.substring(0, 200) + '...'
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process the PDF document.' });
  }
});

// Semantic Search & Risk Analysis Endpoint
app.post('/api/documents/ask', async (req, res) => {
  try {
    const { documentId, question } = req.body;

    if (!documentId || !question) {
      return res.status(400).json({ error: 'Missing documentId or question.' });
    }

    console.log(`Analyzing Document [${documentId}] for question: "${question}"`);

    // 1. Convert the user's question into a 768-dimension vector
    const queryResponse = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: question,
      config: { outputDimensionality: 768 }
    });
    const queryVector = queryResponse.embeddings[0].values;

    // 2. Search Qdrant for the Top 5 most relevant chunks from THIS specific document
    const qdrantResponse = await qdrant.query(COLLECTION_NAME, {
      vector: queryVector,
      filter: {
        must: [{ key: 'document_id', match: { value: documentId } }]
      },
      limit: 5,
      with_payload: true, 
    });

    const searchResults = qdrantResponse.points || qdrantResponse;

    if (searchResults.length === 0) {
      return res.json({ answer: "I couldn't find any relevant information in this document.", sources: [] });
    }

    // 3. Stitch the retrieved chunks together to create the "Context"
    const contextText = searchResults
      .map((hit, index) => `--- CHUNK ${index + 1} ---\n${hit.payload.text}`)
      .join('\n\n');

    // 4. Construct a strict prompt for Gemini 1.5 Flash
    const prompt = `
      You are ContraLens, an expert Legal AI Assistant. 
      Answer the user's question based ONLY on the provided contract excerpts below. 
      If the excerpts do not contain the answer, say "The provided document does not contain this information." Do not guess.
      
      CONTEXT:
      ${contextText}
      
      QUESTION: ${question}
    `;

    // 5. Generate the Final Answer
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt
    });

    res.status(200).json({
      answer: aiResponse.text,
      // Return the chunks used so the frontend can highlight them for the user later
      sources: searchResults.map(hit => ({
        chunkIndex: hit.payload.chunk_index,
        text: hit.payload.text
      }))
    });

  } catch (error) {
    console.error('Retrieval Error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze the document.' });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 ContraLens Server running on port ${PORT}`);
});