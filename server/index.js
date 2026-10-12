const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const multer = require('multer');
const pdf = require('pdf-extraction');
const { GoogleGenAI } = require('@google/genai');

dotenv.config();

// Strip any accidental spaces/quotes
const rawKey = process.env.GEMINI_API_KEY || '';
const cleanApiKey = rawKey.replace(/['"]/g, '').trim();

// Initialize the new SDK
const ai = new GoogleGenAI({ apiKey: cleanApiKey });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure Multer to keep files in memory (RAM)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed.'), false);
    }
  }
});
// Utility: Sliding-Window Chunking
function createChunks(text, chunkSize = 1000, overlap = 150) {
  const chunks = [];
  let startIndex = 0;
  
  while (startIndex < text.length) {
    // Slice a chunk of the specified size
    const chunk = text.slice(startIndex, startIndex + chunkSize);
    chunks.push(chunk);
    
    // Move the start index forward, minus the overlap
    startIndex += (chunkSize - overlap);
  }
  
  return chunks;
}

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'ContraLens API Gateway is active.' });
});

// Document Upload & Parsing Endpoint
app.post('/api/documents/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    console.log("Processing file:", req.file.originalname);

    // 1. Extract text from the PDF buffer using the new library
    const pdfData = await pdf(req.file.buffer);
    const extractedText = pdfData.text.trim();

    // 2. Fallback check for scanned documents
    if (extractedText.length < 50) {
      return res.status(422).json({ 
        error: 'No readable text found. This appears to be a scanned document. Please upload a text-based PDF.' 
      });
    }

    // 3. Chop the text into overlapping chunks
    const chunks = createChunks(extractedText, 1000, 150);
    console.log(`Document split into ${chunks.length} chunks. Generating embeddings...`);

    // 4. Generate Vector Embeddings using the new @google/genai SDK
    const chunkData = await Promise.all(chunks.map(async (chunk, index) => {
      const response = await ai.models.embedContent({
        model: 'gemini-embedding-001',
        contents: chunk
      });
      
      return {
        chunkIndex: index,
        text: chunk,
        // The new SDK nests the values slightly differently
        embedding: response.embeddings[0].values 
      };
    }));

    console.log(`✅ Successfully generated embeddings for ${chunkData.length} chunks!`);

    // 5. Return the parsed data to the frontend
    res.status(200).json({
      message: 'PDF successfully parsed, chunked, and embedded!',
      fileName: req.file.originalname,
      pageCount: pdfData.numpages,
      chunkCount: chunkData.length,
      embeddingDimensions: chunkData[0].embedding.length, // Should be 768
      preview: chunkData[0].text.substring(0, 200) + '...'
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process the PDF document.' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 ContraLens Server running on port ${PORT}`);
});