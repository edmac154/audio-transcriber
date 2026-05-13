export const metadata = {
  title: 'Audio Transcriber',
  description: 'Realtime audio processing platform'
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