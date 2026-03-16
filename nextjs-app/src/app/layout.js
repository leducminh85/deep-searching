import './globals.css';

export const metadata = {
  title: 'Wevic - Deep Video Search',
  description: 'Deep Video Search - Tìm kiếm video chuyên sâu',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
