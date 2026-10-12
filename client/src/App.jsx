import { useState } from 'react';

function App() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus('idle');
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStatus('loading');
    const formData = new FormData();
    formData.append('document', file);

    try {
      const response = await fetch('http://localhost:5000/api/documents/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setStatus('success');
      setResult(data);
    } catch (error) {
      console.error('Upload error:', error);
      setStatus('error');
      setErrorMessage(error.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full space-y-8 bg-white p-10 rounded-xl shadow-lg border border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 text-center">
            ContraLens
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Strategic Contract Risk & Portfolio Optimization Engine
          </p>
        </div>

        <div className="mt-8 space-y-6">
          <div className="flex items-center justify-center w-full">
            <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg className="w-10 h-10 mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                </svg>
                <p className="mb-2 text-sm text-gray-500"><span className="font-semibold">Click to upload</span> a contract (PDF)</p>
                <p className="text-xs text-gray-500">{file ? file.name : "No file selected"}</p>
              </div>
              <input type="file" className="hidden" accept=".pdf" onChange={handleFileChange} />
            </label>
          </div>

          <button
            onClick={handleUpload}
            disabled={!file || status === 'loading'}
            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
              !file || status === 'loading' ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {status === 'loading' ? 'Processing Document...' : 'Analyze Document'}
          </button>
        </div>

        {/* Results Section */}
        {status === 'error' && (
          <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-md border border-red-200">
            {errorMessage}
          </div>
        )}

        {status === 'success' && result && (
          <div className="mt-6 p-6 bg-green-50 rounded-md border border-green-200">
            <h3 className="text-lg font-medium text-green-900 mb-2">Extraction Successful!</h3>
            <ul className="text-sm text-green-800 space-y-1 mb-4">
              <li><strong>File:</strong> {result.fileName}</li>
              <li><strong>Pages:</strong> {result.pageCount}</li>
              <li><strong>Characters Extracted:</strong> {result.textLength}</li>
            </ul>
            <div className="bg-white p-4 rounded border border-green-100 text-xs text-gray-700 overflow-y-auto max-h-40 font-mono">
              {result.preview}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;