'use client';
export default function ErrorPage({ reset }) {
  return <main className="authpage"><div className="authcard"><h1>GNS Capacity kunne ikke lastes</h1><p>En feil oppstod. Prøv igjen. Kontakt GNS dersom feilen vedvarer.</p><button className="primary full" onClick={reset}>Prøv igjen</button><a className="link" href="/">Til innlogging</a></div></main>;
}
