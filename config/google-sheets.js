process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let sheetsAPI = null;
const DOC_ID = '1Zzk_WwQatNDA3nuOEH0k27ZpzLFpHrNr0NrlSiFCDv4';

async function initDB() {
  try {
    const credsPath = path.join(__dirname, 'credentials.json');
    let auth;
    
    if (fs.existsSync(credsPath)) {
      auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      console.warn('⚠️ credentials.json or Environment Variables not found.');
      return null;
    }

    sheetsAPI = google.sheets({ version: 'v4', auth });
    
    // Test connection by fetching spreadsheet details
    const res = await sheetsAPI.spreadsheets.get({ spreadsheetId: DOC_ID });
    console.log('Connected to Google Sheet DB:', res.data.properties.title);
    return sheetsAPI;
  } catch (error) {
    console.error('Error connecting to Google Sheets:', error.message);
    sheetsAPI = null; 
    return null;
  }
}

async function getQuizQuestions(quizId) {
  if (!sheetsAPI) {
    console.log("Using Mock Data (No DB Connected or API Failed)");
    return [
      { question: "ما هي عاصمة جمهورية مصر العربية؟", options: ["الإسكندرية", "القاهرة", "الجيزة", "الأقصر"], correct: 1, timeLimit: 20, mode: "Classic" },
      { question: "كم عدد قارات العالم؟", options: ["5", "6", "7", "8"], correct: 2, timeLimit: 20, mode: "Classic" },
      { question: "من هو مكتشف الجاذبية الأرضية؟", options: ["آينشتاين", "نيوتن", "جاليليو", "فيثاغورس"], correct: 1, timeLimit: 30, mode: "Classic" }
    ];
  }

  try {
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Quizzes_and_Questions!A2:I', // Assuming row 1 is header
    });
    
    const rows = response.data.values;
    if (!rows || rows.length === 0) return [];
    
    // Filter and map exactly like before
    return rows
      .filter(row => row[0] === quizId || quizId === 'default') // row[0] is Quiz_ID
      .map(row => ({
        question: row[1],
        options: [row[2], row[3], row[4], row[5]],
        correct: parseInt(row[6]),
        timeLimit: parseInt(row[7]) || 20,
        mode: row[8] || 'Classic'
      }));
  } catch (err) {
    console.error("Error fetching questions:", err.message);
    return [];
  }
}

async function saveGameResult(data) {
  if (!sheetsAPI) return;
  try {
    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId: DOC_ID,
      range: 'Game_Results!A:E',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          data.pin,
          data.name,
          data.score,
          data.correctCount,
          new Date().toISOString()
        ]]
      }
    });
  } catch (err) {
    console.error("Error saving game result:", err.message);
  }
}

async function addInstitution(data) {
  if (!sheetsAPI) return false;
  try {
    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId: DOC_ID,
      range: 'Institutions!A:F',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [[
          data.id,
          data.name,
          data.username,
          data.password, // In production this should be hashed
          data.maxStudents || 100,
          'Active'
        ]]
      }
    });
    return true;
  } catch (err) {
    console.error("Error adding institution:", err.message);
    return false;
  }
}

async function checkInstitutionLogin(username, password) {
  if (!sheetsAPI) return null;
  try {
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Institutions!A:F',
    });
    const rows = response.data.values || [];
    const tenant = rows.find(row => 
      row[2] && row[3] &&
      row[2].trim().toLowerCase() === username.trim().toLowerCase() && 
      row[3].trim() === password.trim() && 
      row[5] === 'Active'
    );
    if (tenant) {
      return { id: tenant[0], name: tenant[1], maxStudents: tenant[4] };
    }
    return null;
  } catch (err) {
    console.error("Error checking login:", err.message);
    return null;
  }
}

async function uploadCSVQuestions(questions) {
  if (!sheetsAPI) return false;
  try {
    const values = questions.map(q => [
      q.Quiz_ID,
      q.Question_Text,
      q.Option1,
      q.Option2,
      q.Option3,
      q.Option4,
      q.Correct_Answer,
      q.Time_Limit || 20,
      q.Game_Mode || 'Classic'
    ]);

    await sheetsAPI.spreadsheets.values.append({
      spreadsheetId: DOC_ID,
      range: 'Quizzes_and_Questions!A:I',
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
    return true;
  } catch (err) {
    console.error("Error uploading CSV to sheets:", err.message);
    return false;
  }
}

async function getAllInstitutions() {
  if (!sheetsAPI) return [];
  try {
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Institutions!A:F',
    });
    const rows = response.data.values || [];
    return rows.map(row => ({
      id: row[0],
      name: row[1],
      username: row[2],
      maxStudents: row[4],
      status: row[5] || 'Active'
    }));
  } catch (err) {
    console.error("Error fetching institutions:", err.message);
    return [];
  }
}

async function deleteInstitution(id) {
  if (!sheetsAPI) return false;
  try {
    // 1. Get all to find the row index
    const response = await sheetsAPI.spreadsheets.values.get({
      spreadsheetId: DOC_ID,
      range: 'Institutions!A:F',
    });
    const rows = response.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === id);
    
    if (rowIndex === -1) return false;
    
    // 2. Update the status column (F, which is index 5) to 'Deleted'
    // Row index in sheet is 1-based. So rowIndex + 1.
    const sheetRow = rowIndex + 1;
    await sheetsAPI.spreadsheets.values.update({
      spreadsheetId: DOC_ID,
      range: `Institutions!F${sheetRow}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [['Deleted']] }
    });
    
    return true;
  } catch (err) {
    console.error("Error deleting institution:", err.message);
    return false;
  }
}

module.exports = { initDB, getQuizQuestions, saveGameResult, addInstitution, checkInstitutionLogin, uploadCSVQuestions, getAllInstitutions, deleteInstitution };
