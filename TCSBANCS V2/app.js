// Required packages
const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Initialize express app
const app = express();
const port = 3000;

/*
// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept only excel files
    const filetypes = /xlsx|xls/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only Excel files are allowed!'));
  }
});
*/

const today = new Date(Date.now());
const formattedDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
//console.log(formattedDate);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "./uploads")
      },
    filename: function (req, file, cb) {
        const uniqueName = formattedDate + file.originalname;
        console.log(uniqueName);
        cb(null, file.fieldname + '-' + uniqueName)
      }
    });

    const upload = multer({ storage: storage })

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }  // Needed for Railway
    })

    pool.connect()
    .then(() => console.log("Connected to PostgreSQL!"))
    .catch(err => console.error("Database connection error", err));

// PostgreSQL connection
/* const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'excel_data',
  password: 'TCSBANCS',
  port: 5432,
}); */

// Set up EJS for templates
app.set('view engine', 'ejs');
app.use(express.static('public'));

// Home page route
app.get('/', (req, res) => {
  res.render('index');
});

// Upload Excel file route
app.post('/upload', upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    
    // Read the Excel file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    if (data.length === 0) {
      return res.status(400).send('Excel file is empty.');
    }

    // Create a table for this file
    const tableName = fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    
    // Extract column names and types from the first row
    const columns = Object.keys(data[0]);
    
    // Drop table if exists and create new one
    await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
    
    // Create columns dynamically
    const columnDefinitions = columns.map(col => {
      const colName = col.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
      return `${colName} TEXT`;
    }).join(', ');
    
    await pool.query(`CREATE TABLE ${tableName} (id SERIAL PRIMARY KEY, ${columnDefinitions})`);
    
    // Insert data
    for (const row of data) {
      const colNames = columns.map(col => col.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()).join(', ');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
      const values = columns.map(col => row[col] !== undefined ? row[col].toString() : null);
      
      await pool.query(`INSERT INTO ${tableName} (${colNames}) VALUES (${placeholders})`, values);
    }
    
    res.render('success', { fileName, tableName });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error processing file: ${error.message}`);
  }
});

// Route to display data from a specific Excel file
app.get('/data/:tableName', async (req, res) => {
  try {
    const tableName = req.params.tableName;
    
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = $1
      )
    `, [tableName]);
    
    if (!tableCheck.rows[0].exists) {
      return res.status(404).send('Table not found.');
    }
    
    // Get column names
    const columnsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = $1 AND column_name != 'id'
    `, [tableName]);
    
    const columns = columnsResult.rows.map(row => row.column_name);
    
    // Get data
    const dataResult = await pool.query(`SELECT * FROM ${tableName}`);
    
    res.render('data', { 
      tableName, 
      columns, 
      data: dataResult.rows 
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error fetching data: ${error.message}`);
  }
});

// Route to list all available tables
app.get('/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name != 'pg_stat_statements'
    `);
    
    const tables = result.rows.map(row => row.table_name);
    res.render('tables', { tables });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send(`Error fetching tables: ${error.message}`);
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
