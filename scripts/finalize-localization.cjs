// One-time migration companion. Removed from the final tree by the preparation workflow.
const fs = require('node:fs');
function update(path, work) { const before = fs.readFileSync(path, 'utf8'); const after = work(before); if (before === after) throw new Error(`Expected migration not applied: ${path}`); fs.writeFileSync(path, after); }
update('lib/i18n-labels.mjs', source => source.replace(/\n`;\n$/, `
En feil oppstod. Prøv igjen. Kontakt GNS dersom feilen vedvarer.|An error occurred. Try again. Contact GNS if it persists.|Ein Fehler ist aufgetreten. Versuchen Sie es erneut. Kontaktieren Sie GNS, falls er bestehen bleibt.|Une erreur est survenue. Réessayez. Contactez GNS si elle persiste.|Der opstod en fejl. Prøv igen. Kontakt GNS, hvis fejlen fortsætter.|Ett fel uppstod. Försök igen. Kontakta GNS om felet kvarstår.|Er is een fout opgetreden. Probeer opnieuw. Neem contact op met GNS als de fout aanhoudt.
GNS Capacity kunne ikke lastes|GNS Capacity could not be loaded|GNS Capacity konnte nicht geladen werden|GNS Capacity n’a pas pu être chargé|GNS Capacity kunne ikke indlæses|GNS Capacity kunde inte laddas|GNS Capacity kon niet worden geladen
Til innlogging|Go to sign-in|Zur Anmeldung|Aller à la connexion|Til login|Till inloggning|Naar inloggen
×|×|×|×|×|×|×
\`;\n`));
update('lib/i18n.mjs', source => source.replace("hourCycle: 'h23', timeZone: 'Europe/Oslo' }).format(date)];", "hourCycle: 'h23', timeZone: 'Europe/Oslo' }).format(date).replace('.', ':')];"));
for (const path of ['tests/rendered-components.test.mjs', 'tests/loads.test.mjs']) {
  update(path, source => source.replace(".replace('../lib/capacity.mjs',", ".replace('./i18n-provider',new URL('./i18n-test-context.mjs',import.meta.url).href)\n .replace('../lib/capacity.mjs',")
    .replaceAll('<option selected="">Maskinsemi', '<option value="Maskinsemi" selected="">Maskinsemi')
    .replaceAll('<option selected="">Nord-Norge', '<option value="Nord-Norge" selected="">Nord-Norge'));
}
(async () => {
  const { dictionaries } = await import('../lib/i18n.mjs');
  const keys = JSON.parse(fs.readFileSync('tests/i18n-source-keys.json', 'utf8'));
  const missing = keys.filter(key => !dictionaries.nb.has(key));
  fs.writeFileSync('test-artifacts/i18n-untranslated.json', JSON.stringify(missing, null, 2));
  console.log('Completed UI translation audit:', { keys: keys.length, missing });
})();
