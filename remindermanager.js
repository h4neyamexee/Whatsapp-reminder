const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const reminderFile = path.join(__dirname, 'reminders.json');
let reminders = [];

if (fs.existsSync(reminderFile)) {
  reminders = JSON.parse(fs.readFileSync(reminderFile));
  console.log(`✅ Loaded ${reminders.length} saved reminders.`);
} else {
  console.log('ℹ️ No saved reminders found. Starting fresh.');
}

function saveReminders() {
  fs.writeFileSync(reminderFile, JSON.stringify(reminders, null, 2));
  console.log('💾 Reminders saved to disk.');
}

function sanitizeJSON(input) {
  try {
    const clean = input.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error("❌ Error parsing AI response:", err.message);
    return null;
  }
}

function to24HourFormat(timeStr) {
  const lower = timeStr.trim().toLowerCase();
  const [time, modifier] = lower.split(' ');
  let [hours, minutes] = time.split(':').map(Number);

  if (modifier === 'pm' && hours < 12) hours += 12;
  if (modifier === 'am' && hours === 12) hours = 0;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// 🔍 Check if reminder is encouraged, permissible, or discouraged
async function isReminderIslamicallyEncouraged(text) {
  const prompt = `
Evaluate the following activity based on Islamic principles. Categorize it into one of these:
- Encouraged (e.g., prayer, charity, seeking knowledge)
- Permissible (e.g., eating, working, resting)
- Discouraged (e.g., wasting time, watching movies for entertainment, backbiting)

Activity: "${text}"

Reply with one word only: Encouraged, Permissible, or Discouraged.
  `.trim();

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
  });

  return response.choices?.[0]?.message?.content?.trim().toLowerCase();
}

async function handleMessage(msg, client) {
  const chatId = msg.from;
  const input = msg.body;

  console.log(`🟡 Received: "${input}" from ${chatId}`);

  const prompt = `
You are a helpful assistant managing WhatsApp reminders.

Return ONLY JSON. No explanation.

\`\`\`json
{
  "action": "create" or "delete",
  "text": "reminder content",
  "time": "HH:mm",
  "repeat": "once" or "daily"
}
\`\`\`

Examples:
User: Remind me to pray Fajr at 5:00 AM  
→ {
  "action": "create",
  "text": "pray Fajr",
  "time": "05:00",
  "repeat": "daily"
}

User: Delete my Fajr reminder  
→ {
  "action": "delete",
  "text": "pray Fajr"
}

Now extract data for:
"${input}"
`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = completion.choices[0].message.content;
    const data = sanitizeJSON(raw);

    if (!data) {
      console.warn('⚠️ No valid reminder data returned.');
      return msg.reply('⚠️ Could not understand the reminder. Try again.');
    }

    const { action, text, time, repeat = 'once' } = data;

    if (action === 'create' && text && time) {
      const category = await isReminderIslamicallyEncouraged(text);

      if (category === 'discouraged') {
        console.log(`❌ Rejected reminder (Islamically discouraged): "${text}"`);
        return msg.reply(
          `⚠️ This activity may not be encouraged in Islam.\n\n` +
          `Consider using your time for something beneficial like reading, reflecting, or dhikr.\n\n` +
          `🕊️ "Indeed, the best of people are those who are most beneficial to others." (Hadith)`
        );
      }

      reminders.push({ chatId, text, time, repeat });
      saveReminders();
      console.log(`✅ Reminder added: "${text}" at ${time} (${repeat})`);
      await msg.reply(`✅ Reminder set for "${text}" at ${time} (${repeat})`);

    } else if (action === 'delete') {
      const before = reminders.length;

      if (text?.toLowerCase().includes('all')) {
        reminders = reminders.filter(r => r.chatId !== chatId);
        const after = reminders.length;
        saveReminders();
        console.log(`🗑️ Deleted all reminders. Total deleted: ${before - after}`);
        await msg.reply(`🗑️ All your reminders have been deleted.`);
      } else if (text) {
        reminders = reminders.filter(r => !(r.chatId === chatId && r.text === text));
        const after = reminders.length;
        saveReminders();
        console.log(`🗑️ Deleted reminder "${text}". Total deleted: ${before - after}`);
        await msg.reply(`🗑️ Reminder "${text}" deleted.`);
      } else {
        console.warn('⚠️ No valid reminder to delete.');
        await msg.reply('⚠️ Could not find a reminder to delete. Please specify the reminder text or say "delete all reminders".');
      }
    } else {
      console.warn('⚠️ Could not determine create/delete action.');
      await msg.reply('⚠️ Could not understand the reminder. Try again.');
    }

  } catch (error) {
    console.warn('⚠️ OpenAI error ignored:', error.message);
  }
}

async function generateMotivation(text) {
  try {
    const prompt = `
You are a helpful Islamic assistant.

Your task is to check if the user's reminder involves something:
1. Islamic (e.g., namaz, prayer, Quran, zakat, fasting): respond with a short Quran/Hadith-based motivational message.
2. Halal (e.g., study, work, helping mom): respond with a general motivational message.
3. Haram (e.g., alcohol, drugs, zina, gambling, clubbing, stealing, watching inappropriate content, etc.): WARN the user firmly but politely with an Islamic reminder that this is not allowed and advise repentance.
Only return the message.and reference with number if you mention any ayat, hadees or any islamic book.(never give wrong hadith number) No explanation or JSON.

Reminder: "${text}"
`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    const message = completion.choices?.[0]?.message?.content?.trim();
    console.log(`🌙 Motivation generated for "${text}": ${message}`);
    return message || '';
  } catch (err) {
    console.error('❌ Error generating motivation:', err.message);
    return '';
  }
}

function startReminderLoop(client) {
  setInterval(async () => {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:mm

    for (const reminder of reminders) {
      if (reminder.time === currentTime && !reminder.sent) {
        reminder.sent = true;
        saveReminders();

        try {
          console.log(`🔔 Sending reminder to ${reminder.chatId} — "${reminder.text}"`);

          const motivation = await generateMotivation(reminder.text);
          const message = `⏰ Reminder: *${reminder.text}*${motivation ? `\n\n✨ ${motivation}` : ''}`;

          const chat = await client.getChatById(reminder.chatId);
          await chat.sendMessage(message);
          console.log(`✅ Message sent to ${reminder.chatId}`);

          if (reminder.repeat === 'once') {
            reminders = reminders.filter(r => !(r.chatId === reminder.chatId && r.text === reminder.text));
            saveReminders();
            console.log(`🧹 One-time reminder "${reminder.text}" removed.`);
          } else {
            setTimeout(() => {
              reminder.sent = false;
              saveReminders();
              console.log(`🔄 Reset sent flag for reminder "${reminder.text}"`);
            }, 60 * 1000);
          }

        } catch (err) {
          console.error('❌ Error sending reminder:', err.message);
        }
      }
    }
  }, 3000); // every 3 seconds
}

module.exports = { handleMessage, startReminderLoop };
