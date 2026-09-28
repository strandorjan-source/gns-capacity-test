import './globals.css';
import './i18n.css';
import I18nProvider from './i18n-provider';
export const metadata = { title: 'GNS Capacity', description: 'Ledige biler – GNS Cargo AS' };
export default function RootLayout({ children }) { return <html lang="nb"><body><I18nProvider>{children}</I18nProvider></body></html>; }
