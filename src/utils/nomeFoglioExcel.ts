/**
 * Nome di foglio valido per Excel: al massimo 31 caratteri, senza : \ / ? * [ ],
 * senza apostrofi in testa o in coda e unico senza distinzione di maiuscole.
 * Due omonimi diventano "Rossi Mario" e "Rossi Mario (2)".
 */
export function nomeFoglio(nome: string, usati: Set<string>): string {
  const pulito = nome.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^'+|'+$/g, '').trim();
  const base = pulito.slice(0, 31) || 'Dipendente';
  let candidato = base;
  for (let n = 2; usati.has(candidato.toLowerCase()); n++) {
    const suffisso = ` (${n})`;
    candidato = base.slice(0, 31 - suffisso.length) + suffisso;
  }
  usati.add(candidato.toLowerCase());
  return candidato;
}
