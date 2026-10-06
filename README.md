# GNS Capacity

Kapasitetstorg for GNS Cargo AS. Transportører registrerer konkrete biler med
registreringsnummer. Godkjente GNS-brukere ser alle biler og kan reservere eller
frigi kapasitet.

## Miljøvariabler

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` eller `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Microsoft/Azure OAuth konfigureres i Supabase Auth. Produksjonsadressen må ligge i
Supabase sin redirect allow-list.

## Samlet plattformtilgang

Cargo viser denne appen under `https://gnscargo.vercel.app/capacity` og videresender
Next.js-ressursene. Samme domene gjør at begge appene kan bruke den samme
Supabase-økten. Den opprinnelige Capacity-adressen fungerer fortsatt.

`platform_current_access` og `capacity_platform_users` henter serverstyrt
plattformtilgang. Superbrukere får Capacity-administrasjon; andre beholder sine
ordinære Capacity-roller. En deaktivert eller slettet Cargo-bruker mister også
Capacity-tilgangen. Kapasitets- og ordrehistorikk beholdes. Tilgangen sjekkes på
nytt ved polling, fokus og tokenfornyelse, mens RLS håndhever den umiddelbart.
Databaseendringen ligger i `strandorjan-source/gnscargo`, migrasjonen
`20261006165835_platform_superusers_and_removal.sql`, og må være installert før
appen publiseres med disse RPC-kallene.
