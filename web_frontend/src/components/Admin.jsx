import React, { useState } from 'react';

const Admin = () => {
    const [password, setPassword] = useState('');
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const handleUpload = async (e) => {
        e.preventDefault();

        if (!password) {
            setError('Vui lòng nhập mật khẩu');
            return;
        }
        if (!file) {
            setError('Vui lòng chọn file');
            return;
        }

        setLoading(true);
        setError(null);
        setSuccess(null);

        const formData = new FormData();
        formData.append('password', password);
        formData.append('file', file);

        try {
            const response = await fetch('http://localhost:8000/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Upload failed');
            }

            setSuccess('Tải lên dữ liệu thành công!');
            setFile(null);
            // Reset input type file
            const fileInput = document.getElementById('admin-file-upload');
            if (fileInput) fileInput.value = '';

        } catch (err) {
            setError(err.message || 'Lỗi tải lên file. Vui lòng thử lại.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="admin-card">
            <h2>Quản trị viên</h2>
            <p style={{ marginBottom: '1.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
                Tải lên file data.xlsx mới để cập nhật hệ thống.
            </p>

            <form onSubmit={handleUpload}>
                <div className="form-group">
                    <label htmlFor="admin-password">Mật khẩu</label>
                    <input
                        id="admin-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Nhập mật khẩu upload..."
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="admin-file-upload">File Excel (.xlsx)</label>
                    <input
                        id="admin-file-upload"
                        type="file"
                        accept=".xlsx, .xls"
                        onChange={handleFileChange}
                        className="file-input"
                    />
                </div>

                {error && <div className="error-message">{error}</div>}
                {success && <div className="success-message">{success}</div>}

                <button
                    type="submit"
                    className="btn"
                    disabled={loading}
                    style={{ width: '100%', marginTop: '1rem' }}
                >
                    {loading ? (
                        <><span className="loader" style={{ width: '1rem', height: '1rem', marginRight: '0.5rem', borderWidth: '2px' }}></span> Đang tải lên...</>
                    ) : 'Tải lên dữ liệu'}
                </button>
            </form>
        </div>
    );
};

export default Admin;
