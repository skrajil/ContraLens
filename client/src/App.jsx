import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  Trash2,
  Search,
  ArrowRight,
  RefreshCw,
  Settings,
  ShieldAlert,
  LogOut,
  UploadCloud,
  Loader2,
  CheckCircle,
  AlertCircle,
  Send,
  AlertTriangle,
  Scale,
  MessageSquarePlus,
  CheckCircle2,
} from 'lucide-react';
  import axios from 'axios';

const API_BASE = 'http://localhost:5000';
const READY_STATUSES = ['completed', 'ready', 'processed', 'embedded'];

const isDocReady = (status = '') => READY_STATUSES.includes(status.toLowerCase());

// --- 1. Executive Dashboard ---
const Dashboard = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [documentId, setDocumentId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | uploading | processing | success | error
  const [errorMessage, setErrorMessage] = useState('');
  const [metrics, setMetrics] = useState({ total: 0, highRisk: 0, safe: 0 });

  const fetchMetrics = async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/api/documents`);
      const docs = Array.isArray(data) ? data : [];
      setMetrics({
        total: docs.length,
        highRisk: docs.filter((d) => typeof d.risk_score === 'number' && d.risk_score >= 70).length,
        safe: docs.filter((d) => typeof d.risk_score === 'number' && d.risk_score < 40).length,
      });
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

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
      const response = await axios.post(`${API_BASE}/api/documents/upload`, formData);
      setDocumentId(response.data.documentId);
      setStatus('processing');
    } catch (error) {
      console.error('Upload error:', error);
      setStatus('error');
      setErrorMessage(error.response?.data?.error || 'Upload failed');
    }
  };

  useEffect(() => {
    let intervalId;
    if (status === 'processing' && documentId) {
      intervalId = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/api/documents/status/${documentId}`);
          const currentStatus = (res.data.status || '').toLowerCase();

          if (isDocReady(currentStatus)) {
            setStatus('success');
            fetchMetrics();
            clearInterval(intervalId);
          } else if (currentStatus === 'failed' || currentStatus === 'error') {
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Portfolio Overview</h1>
        <p className="text-gray-500 text-sm mt-1">Manage and analyze your legal documents.</p>
      </div>

      {/* Live Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-stripe border border-gray-100">
          <p className="text-gray-500 text-sm font-medium">Total Documents</p>
          <p className="text-4xl font-bold text-gray-900 mt-2">{metrics.total}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-stripe border border-gray-100">
          <p className="text-gray-500 text-sm font-medium">High-Risk Contracts</p>
          <p className="text-4xl font-bold text-red-600 mt-2">{metrics.highRisk}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-stripe border border-gray-100">
          <p className="text-gray-500 text-sm font-medium">Low-Risk Contracts</p>
          <p className="text-4xl font-bold text-emerald-600 mt-2">{metrics.safe}</p>
        </div>
      </div>

      {/* Uploader Module */}
      <div className="bg-white rounded-xl shadow-stripe border border-gray-100 p-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">New Document Analysis</h2>

        {(status === 'idle' || status === 'uploading' || status === 'error') && (
          <div className="space-y-6">
            <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-gray-200 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <UploadCloud className="w-8 h-8 mb-3 text-royal-600" />
                <p className="mb-2 text-sm text-gray-600">
                  <span className="font-semibold text-royal-700">Click to upload</span> a contract (PDF)
                </p>
                <p className="text-xs text-gray-400">
                  {file ? file.name : 'Secure, encrypted transfer'}
                </p>
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

        {status === 'processing' && (
          <div className="flex flex-col items-center justify-center py-12 bg-slate-50 rounded-xl border border-slate-100">
            <Loader2 className="w-10 h-10 text-royal-600 animate-spin mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Vectorizing Contract...</h3>
            <p className="text-sm text-gray-500 max-w-sm text-center">
              Extracting clauses and mapping semantic relationships. Large PDFs take ~1.5 minutes to stay within API limits.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center justify-center py-12 bg-emerald-50 rounded-xl border border-emerald-100">
            <CheckCircle className="w-12 h-12 text-emerald-500 mb-4" />
            <h3 className="text-xl font-bold text-gray-900 mb-1">Analysis Complete</h3>
            <p className="text-sm text-gray-600 mb-6">"{file?.name}" has been successfully indexed.</p>
            <button
              onClick={() => navigate(`/workspace/${documentId}`)}
              className="bg-gray-900 text-white px-6 py-2.5 rounded-lg text-sm font-medium shadow-stripe hover:bg-gray-800 transition-all"
            >
              Open Risk & Chat Workspace →
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- 2. Document Repository ---
const Documents = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const navigate = useNavigate();

  const fetchDocuments = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/api/documents`);
      setDocuments(response.data);
    } catch (error) {
      console.error('Error loading documents:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  useEffect(() => {
    const hasProcessing = documents.some(
      (doc) => doc.status?.toLowerCase() === 'processing'
    );
    if (!hasProcessing) return;

    const interval = setInterval(() => fetchDocuments(true), 4000);
    return () => clearInterval(interval);
  }, [documents]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this contract and all its AI embeddings?')) return;
    setDeletingId(id);
    try {
      await axios.delete(`${API_BASE}/api/documents/${id}`);
      setDocuments((prev) => prev.filter((doc) => doc.id !== id));
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete document.');
    } finally {
      setDeletingId(null);
    }
  };

  const getDocName = (doc) =>
    doc.file_name || doc.filename || doc.name || doc.title || 'Untitled Contract.pdf';

  const filteredDocs = documents.filter((doc) =>
    getDocName(doc).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatusBadge = (status = '') => {
    const normalized = status.toLowerCase();
    if (isDocReady(normalized)) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle size={13} /> Ready
        </span>
      );
    }
    if (normalized === 'failed' || normalized === 'error') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
          <AlertCircle size={13} /> Failed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-royal-50 text-royal-700 border border-royal-200">
        <Loader2 size={13} className="animate-spin" /> Processing...
      </span>
    );
  };

  const renderRiskBadge = (score) => {
    if (typeof score !== 'number') {
      return <span className="text-xs text-slate-400">Not audited</span>;
    }
    const style =
      score >= 70
        ? 'bg-red-50 text-red-700 border-red-200'
        : score >= 40
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style}`}>
        {Math.round(score)} / 100
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Contract Repository</h1>
          <p className="text-sm text-slate-500 mt-1">
            All vectorized agreements synced with Qdrant. Click any ready contract to resume analysis.
          </p>
        </div>
        <button
          onClick={() => fetchDocuments()}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm transition-colors self-start"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search contracts by filename..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-royal-500/20 focus:border-royal-500 shadow-sm"
        />
      </div>

      <div className="bg-white rounded-xl shadow-stripe border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-500 gap-3">
            <Loader2 size={28} className="animate-spin text-royal-600" />
            <p className="text-sm">Loading your contract library...</p>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <FileText size={24} />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              {searchTerm ? 'No matching contracts found' : 'No contracts uploaded yet'}
            </h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              {searchTerm
                ? 'Try a different filename keyword.'
                : 'Upload your first PDF on the Dashboard to vectorize it and unlock AI legal analysis.'}
            </p>
            {!searchTerm && (
              <button
                onClick={() => navigate('/')}
                className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-royal-700 hover:bg-royal-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Go to Upload Dashboard
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-6">Document Name</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6">Risk Score</th>
                  <th className="py-3.5 px-6">Uploaded</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredDocs.map((doc) => {
                  const ready = isDocReady(doc.status);
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-royal-50 text-royal-600 shrink-0">
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 truncate max-w-md" title={getDocName(doc)}>
                              {getDocName(doc)}
                            </p>
                            <p className="text-xs text-slate-400 font-mono truncate max-w-xs">
                              {doc.id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">{renderStatusBadge(doc.status)}</td>
                      <td className="py-4 px-6 whitespace-nowrap">{renderRiskBadge(doc.risk_score)}</td>
                      <td className="py-4 px-6 text-slate-500 whitespace-nowrap text-xs">
                        {doc.upload_date
                          ? new Date(doc.upload_date).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => navigate(`/workspace/${doc.id}`)}
                            disabled={!ready}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              ready
                                ? 'bg-royal-700 hover:bg-royal-600 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            }`}
                          >
                            Open Workspace <ArrowRight size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(doc.id)}
                            disabled={deletingId === doc.id}
                            title="Delete contract"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            {deletingId === doc.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              <Trash2 size={16} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

// --- 3. Automated Legal Risk Scorecard (Left Pane of Workspace) ---
const RiskScorecard = ({ documentId, onSelectQuestion }) => {
  const [data, setData] = useState(null);
  const [docMeta, setDocMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cached, setCached] = useState(false);

  const fetchAnalysis = async (refresh = false) => {
    setLoading(true);
    setError('');
    try {
      const url = `${API_BASE}/api/documents/${documentId}/analysis${
        refresh ? '?refresh=true' : ''
      }`;
      const res = await axios.get(url);
      setData(res.data.analysis);
      setDocMeta(res.data.document);
      setCached(Boolean(res.data.cached));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate risk scorecard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (documentId) fetchAnalysis(false);
  }, [documentId]);

  const getScoreTheme = (score = 0) => {
    if (score >= 70) {
      return {
        ring: 'text-red-600',
        bg: 'bg-red-50',
        border: 'border-red-200',
        bar: 'bg-red-500',
        badge: 'bg-red-100 text-red-700',
      };
    }
    if (score >= 40) {
      return {
        ring: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        bar: 'bg-amber-500',
        badge: 'bg-amber-100 text-amber-700',
      };
    }
    return {
      ring: 'text-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      bar: 'bg-emerald-500',
      badge: 'bg-emerald-100 text-emerald-700',
    };
  };

  const getSeverityBadge = (severity = 'Medium') => {
    const s = severity.toLowerCase();
    if (s === 'high' || s === 'critical') return 'bg-red-50 text-red-700 border-red-200';
    if (s === 'low') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-stripe border border-slate-100 p-6 space-y-5 h-full">
        <div className="flex items-center gap-3 text-royal-700">
          <Loader2 className="animate-spin" size={20} />
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Running Automated Legal Audit...</h3>
            <p className="text-xs text-slate-500">Scanning clauses for liability, IP, and termination exposure</p>
          </div>
        </div>
        <div className="space-y-3 animate-pulse">
          <div className="h-24 bg-slate-100 rounded-xl" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-14 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-lg" />
          </div>
          <div className="h-28 bg-slate-100 rounded-xl" />
          <div className="h-28 bg-slate-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white rounded-xl shadow-stripe border border-red-100 p-6 text-center space-y-3">
        <AlertTriangle className="text-amber-500 mx-auto" size={28} />
        <p className="text-sm font-medium text-slate-800">{error || 'Audit unavailable.'}</p>
        <button
          onClick={() => fetchAnalysis(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-royal-700 hover:bg-royal-600 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <RefreshCw size={14} /> Retry Risk Audit
        </button>
      </div>
    );
  }

  const theme = getScoreTheme(data.riskScore);
  const docName = docMeta?.file_name || docMeta?.filename || docMeta?.name || 'Active Contract';

  return (
    <div className="h-full overflow-y-auto pr-1 space-y-4">
      {/* Overall Risk Score Card */}
      <div className="bg-white rounded-xl shadow-stripe border border-slate-100 p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-royal-600">
                AI Risk Scorecard
              </span>
              {cached && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">
                  Cached
                </span>
              )}
            </div>
            <h2 className="text-sm font-semibold text-slate-900 truncate mt-1" title={docName}>
              {docName}
            </h2>
          </div>
          <button
            onClick={() => fetchAnalysis(true)}
            title="Re-run AI Risk Audit"
            className="p-1.5 text-slate-400 hover:text-royal-700 hover:bg-royal-50 rounded-lg transition-colors shrink-0"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className={`p-4 rounded-xl border ${theme.bg} ${theme.border} space-y-3`}>
          <div className="flex items-end justify-between">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-4xl font-bold tracking-tight ${theme.ring}`}>
                {data.riskScore}
              </span>
              <span className="text-xs font-medium text-slate-500">/ 100 Risk Score</span>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${theme.badge}`}>
              {data.riskLevel} Risk
            </span>
          </div>
          <div className="w-full h-2 bg-white/80 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${theme.bar}`}
              style={{ width: `${Math.min(100, Math.max(0, data.riskScore || 0))}%` }}
            />
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">{data.summary}</p>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-[11px] text-slate-400 block">Contract Type</span>
            <span className="font-medium text-slate-800">{data.metadata?.contractType || 'Not specified'}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-[11px] text-slate-400 block">Governing Law</span>
            <span className="font-medium text-slate-800">{data.metadata?.governingLaw || 'Not specified'}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 col-span-2">
            <span className="text-[11px] text-slate-400 block">Parties</span>
            <span className="font-medium text-slate-800">
              {Array.isArray(data.metadata?.parties) && data.metadata.parties.length > 0
                ? data.metadata.parties.join(' • ')
                : 'Not specified'}
            </span>
          </div>
        </div>
      </div>

      {/* Red Flag Clauses */}
      <div className="bg-white rounded-xl shadow-stripe border border-slate-100 p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
          <ShieldAlert className="text-red-500" size={15} />
          Flagged Risks ({data.redFlags?.length || 0})
        </h3>

        <div className="space-y-3">
          {(data.redFlags || []).map((flag, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-xl border border-slate-100 bg-slate-50/60 hover:border-royal-200 transition-colors space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-900 leading-snug">{flag.title}</h4>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border shrink-0 ${getSeverityBadge(flag.severity)}`}>
                  {flag.severity}
                </span>
              </div>

              {flag.clause && (
                <p className="text-[11px] italic text-slate-500 border-l-2 border-slate-300 pl-2">
                  "{flag.clause}"
                </p>
              )}

              <p className="text-xs text-slate-700 leading-relaxed">{flag.explanation}</p>

              {flag.recommendation && (
                <div className="text-xs bg-royal-50/70 text-royal-900 p-2.5 rounded-lg border border-royal-100">
                  <span className="font-semibold">Suggested Redline: </span>
                  {flag.recommendation}
                </div>
              )}

              <button
                onClick={() =>
                  onSelectQuestion(
                    `Explain the exact contract wording and legal risk behind "${flag.title}", and draft a safer replacement clause.`
                  )
                }
                className="inline-flex items-center gap-1.5 text-xs font-medium text-royal-700 hover:text-royal-900 pt-1"
              >
                <MessageSquarePlus size={14} /> Investigate in Chat →
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Key Obligations */}
      {data.keyObligations?.length > 0 && (
        <div className="bg-white rounded-xl shadow-stripe border border-slate-100 p-5 space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <Scale className="text-royal-600" size={15} />
            Key Obligations & Deadlines
          </h3>
          <ul className="space-y-2">
            {data.keyObligations.map((item, idx) => (
              <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 leading-relaxed">
                <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={14} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// --- 4. Split-Pane AI Workspace ---
const Workspace = () => {
  const { id } = useParams();
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const [query, setQuery] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hello! I have analyzed this contract. What would you like to know?' },
  ]);
  const [isTyping, setIsTyping] = useState(false);

  useEffect(() => {
    setMessages([
      { role: 'assistant', text: 'Hello! I have analyzed this contract. What would you like to know?' },
    ]);
    setQuery('');
  }, [id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleSelectQuestion = (suggestedPrompt) => {
    setQuery(suggestedPrompt);
    inputRef.current?.focus();
  };

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!query.trim() || isTyping || cooldown > 0) return;

    const userMsg = query;
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setQuery('');
    setIsTyping(true);

    try {
      const response = await axios.post(`${API_BASE}/api/documents/ask`, {
        documentId: id,
        question: userMsg,
      });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: response.data.answer,
          sources: response.data.sources,
          modelUsed: response.data.modelUsed,
        },
      ]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage =
        error.response?.data?.error || 'Sorry, I encountered an error analyzing the document.';
      setMessages((prev) => [...prev, { role: 'assistant', text: errorMessage }]);
    } finally {
      setIsTyping(false);
      setCooldown(15);
    }
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-4rem)]">
      {/* Left Pane: Live AI Risk Scorecard */}
      <div className="w-2/5 min-w-[340px] max-w-lg h-full overflow-hidden">
        <RiskScorecard documentId={id} onSelectQuestion={handleSelectQuestion} />
      </div>

      {/* Right Pane: AI Chat Interface */}
      <div className="flex-1 bg-white rounded-xl shadow-stripe border border-gray-100 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-royal-700 text-white rounded-tr-sm'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
                }`}
              >
                <div className="text-sm leading-relaxed space-y-2 [&>ul]:list-disc [&>ul]:pl-5 [&>ul]:space-y-1.5 [&_strong]:font-semibold">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>

                {((msg.sources && msg.sources.length > 0) || msg.modelUsed) && (
                  <div className="mt-4 pt-3 border-t border-gray-100 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      {msg.sources && msg.sources.length > 0 && (
                        <p className="text-xs font-semibold text-gray-400">Sources retrieved:</p>
                      )}
                      {msg.modelUsed && (
                        <span className="text-[10px] font-medium bg-royal-50 text-royal-700 border border-royal-100 px-2 py-0.5 rounded-full">
                          {msg.modelUsed}
                        </span>
                      )}
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {msg.sources.map((src, i) => {
                          const chunkId = src.chunkIndex ?? src.chunk_index ?? i;
                          const scoreDisplay =
                            src.score !== undefined ? `(Score: ${Number(src.score).toFixed(2)})` : '';
                          return (
                            <span
                              key={i}
                              className="text-[10px] bg-slate-100 border border-slate-200 text-slate-600 px-2 py-1 rounded"
                            >
                              Chunk {chunkId} {scoreDisplay}
                            </span>
                          );
                        })}
                      </div>
                    )}
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
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-gray-100">
          <form onSubmit={handleAsk} className="flex gap-3">
            <input
              ref={inputRef}
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
              {cooldown > 0 ? <span className="w-12 text-center">{cooldown}s</span> : <Send size={18} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// --- 5. Sidebar ---
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

// --- 6. Main App Wrapper ---
export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-[#F8FAFC] font-sans">
        <Sidebar />
        <main className="ml-64 p-8 min-h-screen">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/workspace/:id" element={<Workspace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}