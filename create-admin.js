// Uso: node backend/scripts/create-admin.js "Nombre Apellido" email@dominio.com
// La contraseña se toma de la variable ADMIN_PASSWORD o se pide por consola.
require('../config');
const readline = require('readline');
const { db } = require('../db');
const { hashPassword, v } = require('../lib');

(async () => {
  try {
    const name = v.str(process.argv[2], 'name', { min: 2, label: 'El nombre' });
    const email = v.email(process.argv[3]);
    let pw = process.env.ADMIN_PASSWORD;
    if (!pw) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      pw = await new Promise((ok) => rl.question('Contraseña (mínimo 8 caracteres, con letras y números): ', (a) => { rl.close(); ok(a); }));
    }
    v.password(pw);
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) { console.error('Ya existe un usuario con ese email.'); process.exit(1); }
    db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES (?,?,?,'admin')").run(name, email, await hashPassword(pw));
    console.log(`Administrador creado: ${email}`);
  } catch (e) { console.error('Error:', e.message); process.exit(1); }
})();
