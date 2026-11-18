import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { BrowserRouter as Router, Routes, Route, Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { LayoutDashboard, FileText, Settings, ShieldAlert, LogOut, UploadCloud, Loader2, CheckCircle, AlertCircle, Send } from 'lucide-react';
import axios from 'axios';

// --- Step 2: The Functional Executive Dashboard ---
const Dashboard = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, processing, success, error
  const [errorMessage, setErrorMessage] = useState('');

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setErrorMessage('');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus('uploading');
    const formData = new FormData();
    formData.append('document', file);

    try {
      const response = await axios.post('http://localhost:5000/api/documents/upload', formData);
      setDocumentId(response.data.documentId);
      setStatus('processing');
    } catch (error) {
      console.error('Upload error:', error);
      setStatus('error');
      setErrorMessage(error.response?.data?.error || 'Upload failed');
    }
  };

  // Background Polling Logic
  useEffect(() => {
    let intervalId;
    if (status === 'processing' && documentId) {
      intervalId = setInterval(async () => {
        try {
          const res = await axios.get(`http://localhost:5000/api/documents/status/${documentId}`);
          if (res.data.status === 'completed') {
            setStatus('success');
            clearInterval(intervalId);
          } else if (res.data.status === 'failed') {
            setStatus('error');
            setErrorMessage('The AI engine encountered an error while processing.');
            clearInterval(intervalId);
          }
        } catch (err) {
          console.error('Status check failed:', err);
        }
      }, 3000);
    }
    return () => clearInterval(intervalId);
  }, [status, documentId]);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Portfolio Overview</h1>
          <p className="text-gray-500 text-sm mt-1">Manage and analyze your legal documents.</p>
        </div>
      </div>
      
      {/* Top Metrics Cards */}
      <div className="grid grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-stripe border border-gray-100 flex flex-col justify-center">
          <p className="text-gray-500 text-sm font-medium">Total Documents</p>
          <p className="text-4xl font-bold text-gray-900 mt-2">12</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-stripe border border-gray-100 flex flex-col justify-center">
          <p className="text-gray-500 text-sm font-medium">Critical Risks Detected</p>
          <p className="text-4xl font-bold text-red-600 mt-2">3</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-stripe border border-gray-100 flex flex-col justify-center">
          <p className="text-gray-500 text-sm font-medium">Safe Contracts</p>
          <p className="text-4xl font-bold text-emerald-600 mt-2">9</p>
        </div>
      </div>

      {/* The Uploader Module */}
      <div className="bg-white rounded-xl shadow-stripe border border-gray-100 p-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">New Document Analysis</h2>
        
        {/* State: IDLE or UPLOADING */}
        {(status === 'idle' || status === 'uploading' || status === 'error') && (
          <div className="space-y-6">
            <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-gray-200 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <UploadCloud className="w-8 h-8 mb-3 text-royal-600" />
                <p className="mb-2 text-sm text-gray-600"><span className="font-semibold text-royal-700">Click to upload</span> a contract (PDF)</p>
                <p className="text-xs text-gray-400">{file ? file.name : "Secure, encrypted transfer"}</p>
              </div>
              <input type="file" className="hidden" accept=".pdf" onChange={handleFileChange} />
            </label>

            {status === 'error' && (
              <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-lg border border-red-100 text-sm">
                <AlertCircle size={18} />
                {errorMessage}
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || status === 'uploading'}
              className={`w-full py-3 px-4 rounded-lg font-medium shadow-stripe transition-all flex justify-center items-center ${
                !file || status === 'uploading' 
                  ? 'bg-royal-100 text-royal-400 cursor-not-allowed' 
                  : 'bg-royal-700 text-white hover:bg-royal-600'
              }`}
            >
              {status === 'uploading' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Run AI Analysis'}
            </button>
          </div>
        )}

        {/* State: PROCESSING */}
        {status === 'processing' && (
          <div className="flex flex-col items-center justify-center py-12 bg-slate-50 rounded-xl border border-slate-100">
            <Loader2 className="w-10 h-10 text-royal-600 animate-spin mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Vectorizing Contract...</h3>
            <p className="text-sm text-gray-500 max-w-sm text-center">
              Our AI is extracting clauses and mapping semantic relationships. This will take ~1.5 minutes for large PDFs to comply with API limits.
            </p>
          </div>
        )}

        {/* State: SUCCESS */}
        {status === 'success' && (
          <div className="flex flex-col items-center justify-center py-12 bg-emerald-50 rounded-xl border border-emerald-100">
            <CheckCircle className="w-12 h-12 text-emerald-500 mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-1">Analysis Complete</h3>
            <p className="text-sm text-gray-600 mb-6">"{file?.name}" has been successfully indexed.</p>
            
            <button
              onClick={() => navigate(`/workspace/${documentId}`)}
              className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium shadow-stripe hover:bg-gray-800 transition-all"
            >
              Open Chat Workspace →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Step 3: The AI Chat Workspace ---
const Workspace = () => {
  const { id } = useParams(); // Gets the documentId from the URL
  const [query, setQuery] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I have analyzed this contract. What would you like to know?' }
  ]);
  const [isTyping, setIsTyping] = useState(false);

  // Countdown timer effect
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Add user's question to the chat
    const userMsg = query;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setQuery('');
    setIsTyping(true);

    try {
      // Hit our RAG endpoint!
      const response = await axios.post('http://localhost:5000/api/documents/ask', {
        documentId: id,
        question: userMsg
      });

      // Add AI's response to the chat
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        text: response.data.answer,
        sources: response.data.sources 
      }]);
    } catch (error) {
      console.error('Chat error:', error);
      // Display the specific Google 503 error message in the chat UI
      const errorMessage = error.response?.data?.error || 'Sorry, I encountered an error analyzing the document.';
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        text: errorMessage 
      }]);
    } finally {
      setIsTyping(false);
      setCooldown(15); // Start the 15-second Free Tier protection timer
    }
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-4rem)]">
      
      {/* Left Pane: Document Context */}
      <div className="w-1/3 bg-white rounded-xl shadow-stripe border border-gray-100 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-slate-50">
          <h2 className="font-semibold text-gray-900">Contract Analysis</h2>
          <p className="text-xs text-gray-500 mt-1">ID: {id}</p>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-lg">
              <h3 className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                <CheckCircle size={16} /> Status
              </h3>
              <p className="text-sm text-emerald-700 mt-1">Fully vectorized and ready for querying.</p>
            </div>
            
            <div className="p-4 bg-royal-50 border border-royal-100 rounded-lg">
              <h3 className="text-sm font-semibold text-royal-900 flex items-center gap-2">
                <ShieldAlert size={16} /> Strategy Note
              </h3>
              <p className="text-sm text-royal-700 mt-1">
                Ask specific questions about termination clauses, indemnification, or payment terms to get the most accurate semantic retrieval.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Pane: AI Chat Interface */}
      <div className="flex-1 bg-white rounded-xl shadow-stripe border border-gray-100 flex flex-col overflow-hidden">
        
        {/* Chat History */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-royal-700 text-white rounded-tr-sm' 
                  : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
                }`}>
                <div className="text-sm leading-relaxed space-y-2 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1.5 [&_strong]:font-semibold">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                
                {/* Source Citations */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 mb-2">Sources retrieved:</p>
                    <div className="flex gap-2 flex-wrap">
                      {msg.sources.map((src, i) => {
                        // Safely handle different naming conventions from the backend
                        const chunkId = src.chunkIndex ?? src.chunk_index ?? i;
                        const scoreDisplay = src.score !== undefined ? `(Score: ${Number(src.score).toFixed(2)})` : '';
                        
                        return (
                          <span key={i} className="text-[10px] bg-slate-100 border border-slate-200 text-slate-600 px-2 py-1 rounded">
                            Chunk {chunkId} {scoreDisplay}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 text-gray-800 rounded-2xl rounded-tl-sm p-4 shadow-sm flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-royal-600" />
                <span className="text-sm text-gray-500">Synthesizing answer...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-gray-100">
          <form onSubmit={handleAsk} className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask about liabilities, terms, or hidden risks..."
              className="flex-1 border border-gray-200 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-royal-500/20 focus:border-royal-500 transition-all"
            />
            <button 
              type="submit"
              disabled={!query.trim() || isTyping || cooldown > 0}
              className={`px-5 rounded-lg flex items-center justify-center transition-colors shadow-sm font-medium text-sm ${
                !query.trim() || isTyping || cooldown > 0
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200' 
                  : 'bg-royal-700 hover:bg-royal-600 text-white'
              }`}
            >
              {cooldown > 0 ? (
                <span className="w-12 text-center">{cooldown}s</span>
              ) : (
                <Send size={18} />
              )}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
};

// --- Sidebar Component ---
const Sidebar = () => {
  const location = useLocation();
  
  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Documents', path: '/documents', icon: FileText },
    { name: 'Risk Analytics', path: '/analytics', icon: ShieldAlert },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="w-64 bg-slate-900 h-screen flex flex-col fixed left-0 top-0">
      <div className="p-6">
        <h1 className="text-white text-xl font-bold tracking-wider flex items-center gap-2">
          <div className="w-8 h-8 bg-royal-600 rounded-lg flex items-center justify-center">
            <ShieldAlert size={18} className="text-white" />
          </div>
          ContraLens
        </h1>
      </div>
      
      <nav className="flex-1 px-4 mt-6 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive 
                  ? 'bg-royal-700/50 text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <item.icon size={18} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4">
        <button className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-slate-800 w-full transition-colors">
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </div>
  );
};

// --- Main App Wrapper ---
export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[#F8FAFC] font-sans">
        <Sidebar />
        
        {/* Main Content Area (offset by sidebar width) */}
        <main className="ml-64 p-8 min-h-screen">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {/* We will build these out in the next steps */}
            <Route path="/documents" element={<div className="p-10">Documents View (Coming Soon)</div>} />
            <Route path="/workspace/:id" element={<Workspace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}