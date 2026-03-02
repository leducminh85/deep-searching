import React, { useState } from 'react';

const AdminPage = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');

    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [uploadSuccess, setUploadSuccess] = useState(null);
    const rawApiBase = import.meta.env.VITE_API_BASE_URL || '';
    const API_BASE = rawApiBase ? (rawApiBase.startsWith('http') ? rawApiBase : `https://${rawApiBase}`) : '';

    const handleLogin = async (e) => {
        e.preventDefault();
        setAuthError('');

        const formData = new FormData();
        formData.append('password', password);

        try {
            const response = await fetch(`${API_BASE}/api/verify`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                let errorMessage = 'Mật khẩu không đúng';
                try {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const errorData = await response.json();
                        errorMessage = errorData.detail || errorMessage;
                    } else {
                        const text = await response.text();
                        errorMessage = text || errorMessage;
                    }
                } catch (e) {
                    // Fallback if parsing fails
                }
                throw new Error(errorMessage);
            }

            setIsAuthenticated(true);
        } catch (err) {
            setAuthError(`${err.message} (Đang gọi tới: ${API_BASE || 'chưa có API_BASE'}/api/verify)`);
        }
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!file) {
            setUploadError('Vui lòng chọn file');
            return;
        }

        setUploading(true);
        setUploadError(null);
        setUploadSuccess(null);

        const formData = new FormData();
        formData.append('password', password); // Use the password state instead of hardcoded
        formData.append('file', file);

        try {
            const response = await fetch(`${API_BASE}/api/upload`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                if (response.status === 413) {
                    throw new Error('File quá lớn! Vercel chỉ cho phép tải file dưới 4.5MB. Vui lòng chia nhỏ file hoặc dùng VPS.');
                }

                let errorMessage = 'Upload failed';
                try {
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const errorData = await response.json();
                        errorMessage = errorData.detail || errorMessage;
                    } else {
                        errorMessage = await response.text();
                    }
                } catch (e) {
                    // Fallback
                }
                throw new Error(errorMessage);
            }

            setUploadSuccess('Tải lên dữ liệu thành công!');
            setFile(null);
            const fileInput = document.getElementById('admin-file-input');
            if (fileInput) fileInput.value = '';
        } catch (err) {
            setUploadError(err.message || 'Lỗi tải lên file.');
        } finally {
            setUploading(false);
        }
    };

    // Password popup
    if (!isAuthenticated) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
                <div className="admin-card">
                    <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔐</div>
                        <h2 style={{ marginBottom: '0.5rem', color: '#fff' }}>Quản trị viên</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                            Vui lòng nhập mật khẩu hệ thống
                        </p>
                    </div>
                    <form onSubmit={handleLogin}>
                        <div className="form-group">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                autoFocus
                            />
                        </div>
                        {authError && <div className="error-message" style={{ marginBottom: '1.5rem', textAlign: 'center' }}>{authError}</div>}
                        <button type="submit" className="btn" style={{ width: '100%', justifyContent: 'center', padding: '0.875rem' }}>
                            Truy cập ngay
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // Upload form (after authenticated)
    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh' }}>
            <div className="admin-card">
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📦</div>
                    <h2 style={{ marginBottom: '0.5rem', color: '#fff' }}>Cập nhật dữ liệu</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        Tải file Excel mới nhất để làm mới hệ thống
                    </p>
                </div>
                <form onSubmit={handleUpload}>
                    <div className="form-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', cursor: 'pointer', padding: '2rem', border: '2px dashed var(--glass-border)', borderRadius: '16px', justifyContent: 'center' }}>
                            <span style={{ fontSize: '1.25rem' }}>{file ? '📄' : '➕'}</span>
                            <span style={{ color: file ? '#fff' : 'var(--text-muted)' }}>
                                {file ? file.name : 'Chọn file .xlsx từ máy tính'}
                            </span>
                            <input
                                type="file"
                                accept=".xlsx"
                                onChange={(e) => setFile(e.target.files[0])}
                                style={{ display: 'none' }}
                            />
                        </label>
                    </div>

                    {uploadError && <div className="error-message" style={{ textAlign: 'center', marginBottom: '1rem' }}>{uploadError}</div>}
                    {uploadSuccess && <div className="success-message" style={{ textAlign: 'center', marginBottom: '1rem' }}>{uploadSuccess}</div>}

                    <button type="submit" className="btn" disabled={uploading} style={{ width: '100%', justifyContent: 'center', padding: '0.875rem' }}>
                        {uploading ? (
                            <><span className="loader" style={{ width: '1rem', height: '1rem' }}></span> Đang xử lý...</>
                        ) : 'Tải lên ngay'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminPage;
