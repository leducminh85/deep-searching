import React, { useState } from 'react';

const AdminPage = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [password, setPassword] = useState('');
    const [authError, setAuthError] = useState('');

    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState(null);
    const [uploadSuccess, setUploadSuccess] = useState(null);

    const handleLogin = (e) => {
        e.preventDefault();
        if (password === 'Leducminh123') {
            setIsAuthenticated(true);
            setAuthError('');
        } else {
            setAuthError('Mật khẩu không đúng');
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
        formData.append('password', 'Leducminh123');
        formData.append('file', file);

        try {
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Upload failed');
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
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <div className="admin-card">
                    <h2 style={{ marginBottom: '0.5rem' }}>🔒 Admin</h2>
                    <p style={{ marginBottom: '1.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
                        Nhập mật khẩu để truy cập trang quản trị.
                    </p>
                    <form onSubmit={handleLogin}>
                        <div className="form-group">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Nhập mật khẩu..."
                                autoFocus
                            />
                        </div>
                        {authError && <div className="error-message" style={{ marginBottom: '1rem' }}>{authError}</div>}
                        <button type="submit" className="btn" style={{ width: '100%' }}>
                            Đăng nhập
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    // Upload form (after authenticated)
    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
            <div className="admin-card">
                <h2 style={{ marginBottom: '0.5rem' }}>📤 Upload Data</h2>
                <p style={{ marginBottom: '1.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
                    Tải lên file data.xlsx mới để cập nhật hệ thống.
                </p>
                <form onSubmit={handleUpload}>
                    <div className="form-group">
                        <label htmlFor="admin-file-input">File Excel (.xlsx)</label>
                        <input
                            id="admin-file-input"
                            type="file"
                            accept=".xlsx"
                            onChange={(e) => setFile(e.target.files[0])}
                            className="file-input"
                        />
                    </div>

                    {uploadError && <div className="error-message">{uploadError}</div>}
                    {uploadSuccess && <div className="success-message">{uploadSuccess}</div>}

                    <button type="submit" className="btn" disabled={uploading} style={{ width: '100%', marginTop: '1rem' }}>
                        {uploading ? (
                            <><span className="loader" style={{ width: '1rem', height: '1rem', marginRight: '0.5rem', borderWidth: '2px' }}></span> Đang tải lên...</>
                        ) : 'Tải lên dữ liệu'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AdminPage;
