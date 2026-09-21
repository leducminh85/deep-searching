import './globals.css';
import ClientErrorReporter from '../components/ClientErrorReporter';

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
        <ClientErrorReporter />
        {children}
      </body>
    </html>
  );
}
