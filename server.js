const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const reminderManager = require('./remindermanager');

const app = express();
const PORT = process.env.PORT || 3000;

// Web server for Render
app.get('/', (req, res) => {
  res.send('✅ WhatsApp bot is running!');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running at http://localhost:${PORT}`);
});

// WhatsApp client setup
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  qrcode.generate(qr, { small: true });
  console.log('📱 QR code generated. Scan to login.');
});

client.on('ready', () => {
  console.log('✅ WhatsApp client is ready!');
  reminderManager.startReminderLoop(client);
});

client.on('message', async (msg) => {
  try {
    await reminderManager.handleMessage(msg, client);
  } catch (error) {
    console.error('❌ Error handling message:', error.message);
  }
});

client.initialize();
