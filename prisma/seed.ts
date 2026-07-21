import { PrismaClient, Ruolo } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Clear existing data
  await prisma.attivita.deleteMany();
  await prisma.tipoAttivita.deleteMany();
  await prisma.cantiere.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.utente.deleteMany();
  await prisma.configurazione.deleteMany();

  // Create users
  const passwordHash = await bcrypt.hash('admin123', 10);
  const dipPassword = await bcrypt.hash('dip123', 10);

  const responsabile = await prisma.utente.create({
    data: {
      nome: 'Mario',
      cognome: 'Rossi',
      passwordHash,
      ruolo: Ruolo.RESPONSABILE,
      attivo: true,
    },
  });
  console.log(`✅ Created responsabile: ${responsabile.nome} ${responsabile.cognome}`);

  const dipendente1 = await prisma.utente.create({
    data: {
      nome: 'Luigi',
      cognome: 'Verdi',
      passwordHash: null, // No password
      ruolo: Ruolo.DIPENDENTE,
      attivo: true,
    },
  });

  const dipendente2 = await prisma.utente.create({
    data: {
      nome: 'Anna',
      cognome: 'Bianchi',
      passwordHash: null, // No password
      ruolo: Ruolo.DIPENDENTE,
      attivo: true,
    },
  });

  const dipendente3 = await prisma.utente.create({
    data: {
      nome: 'Giuseppe',
      cognome: 'Neri',
      passwordHash: dipPassword, // With password
      ruolo: Ruolo.DIPENDENTE,
      attivo: true,
    },
  });

  console.log(`✅ Created 3 dipendenti`);

  // Helper function to create generic cantiere with activity types
  async function createGenericCantiere(clienteId: number) {
    const cantiere = await prisma.cantiere.create({
      data: {
        clienteId,
        nome: 'Generico',
        isGenerico: true,
        attivo: true,
      },
    });

    await prisma.tipoAttivita.createMany({
      data: [
        { cantiereId: cantiere.id, nome: 'Consulenza' },
        { cantiereId: cantiere.id, nome: 'Supporto' },
        { cantiereId: cantiere.id, nome: 'Altro' },
      ],
    });

    return cantiere;
  }

  // Create clients with cantieri
  // Client 1: Only generic cantiere (no real cantieri)
  const cliente1 = await prisma.cliente.create({
    data: { nome: 'Azienda Trasporti SpA', attivo: true },
  });
  await createGenericCantiere(cliente1.id);
  console.log(`✅ Created cliente: ${cliente1.nome} (only generic cantiere)`);

  // Client 2: With real cantieri
  const cliente2 = await prisma.cliente.create({
    data: { nome: 'Logistica Nord Srl', attivo: true },
  });
  const generico2 = await createGenericCantiere(cliente2.id);

  const cantiere2a = await prisma.cantiere.create({
    data: {
      clienteId: cliente2.id,
      nome: 'Magazzino Milano',
      isGenerico: false,
      attivo: true,
    },
  });
  await prisma.tipoAttivita.createMany({
    data: [
      { cantiereId: cantiere2a.id, nome: 'Carico/Scarico' },
      { cantiereId: cantiere2a.id, nome: 'Inventario' },
      { cantiereId: cantiere2a.id, nome: 'Manutenzione' },
    ],
  });

  const cantiere2b = await prisma.cantiere.create({
    data: {
      clienteId: cliente2.id,
      nome: 'Hub Torino',
      isGenerico: false,
      attivo: true,
    },
  });
  await prisma.tipoAttivita.createMany({
    data: [
      { cantiereId: cantiere2b.id, nome: 'Smistamento' },
      { cantiereId: cantiere2b.id, nome: 'Spedizioni' },
    ],
  });
  console.log(`✅ Created cliente: ${cliente2.nome} with 2 cantieri`);

  // Client 3: With one real cantiere
  const cliente3 = await prisma.cliente.create({
    data: { nome: 'Express Delivery', attivo: true },
  });
  await createGenericCantiere(cliente3.id);

  const cantiere3a = await prisma.cantiere.create({
    data: {
      clienteId: cliente3.id,
      nome: 'Centro Distribuzione Roma',
      isGenerico: false,
      attivo: true,
    },
  });
  await prisma.tipoAttivita.createMany({
    data: [
      { cantiereId: cantiere3a.id, nome: 'Picking' },
      { cantiereId: cantiere3a.id, nome: 'Packing' },
      { cantiereId: cantiere3a.id, nome: 'Consegna' },
    ],
  });
  console.log(`✅ Created cliente: ${cliente3.nome} with 1 cantiere`);

  // Get activity types for sample activities
  const tipoAttivita2a = await prisma.tipoAttivita.findFirst({
    where: { cantiereId: cantiere2a.id, nome: 'Carico/Scarico' },
  });

  const tipoAttivita3a = await prisma.tipoAttivita.findFirst({
    where: { cantiereId: cantiere3a.id, nome: 'Picking' },
  });

  const tipoAttivitaGenerico = await prisma.tipoAttivita.findFirst({
    where: { cantiereId: generico2.id, nome: 'Consulenza' },
  });

  // Create sample activities
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (tipoAttivita2a && tipoAttivita3a && tipoAttivitaGenerico) {
    await prisma.attivita.createMany({
      data: [
        {
          utenteId: dipendente1.id,
          dataRiferimento: today,
          oraInizio: '08:00',
          oraFine: '12:00',
          durataMinuti: 240,
          clienteId: cliente2.id,
          cantiereId: cantiere2a.id,
          tipoAttivitaId: tipoAttivita2a.id,
          note: 'Scarico merce in arrivo da Venezia',
          createdById: dipendente1.id,
        },
        {
          utenteId: dipendente1.id,
          dataRiferimento: today,
          oraInizio: '13:00',
          oraFine: '17:00',
          durataMinuti: 240,
          clienteId: cliente3.id,
          cantiereId: cantiere3a.id,
          tipoAttivitaId: tipoAttivita3a.id,
          note: null,
          createdById: dipendente1.id,
        },
        {
          utenteId: dipendente2.id,
          dataRiferimento: yesterday,
          oraInizio: '09:00',
          oraFine: '13:30',
          durataMinuti: 270,
          clienteId: cliente2.id,
          cantiereId: generico2.id,
          tipoAttivitaId: tipoAttivitaGenerico.id,
          note: 'Supporto tecnico software gestionale',
          createdById: responsabile.id,
        },
      ],
    });
    console.log(`✅ Created 3 sample activities`);
  }

  // Create system configuration
  await prisma.configurazione.createMany({
    data: [
      { chiave: 'backup_retention_days', valore: '30' },
      { chiave: 'finestra_modifica_giorni', valore: '7' },
    ],
  });
  console.log(`✅ Created system configuration`);

  console.log('🎉 Seed completed successfully!');
  console.log('\n📋 Test credentials:');
  console.log('   Responsabile: Mario Rossi - password: admin123');
  console.log('   Dipendente (with password): Giuseppe Neri - password: dip123');
  console.log('   Dipendenti (no password): Luigi Verdi, Anna Bianchi');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
