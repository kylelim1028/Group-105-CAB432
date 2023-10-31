const express = require('express');
const multer = require('multer');
const path = require('path');
const gm = require('gm').subClass({ imageMagick: true }); // Use gm with ImageMagick
const app = express();
const port = 3000;

/*

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: function (req, file, callback) {
    callback(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
});

app.use(express.static('public'));
*/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/upload', upload.single('image'), (req, res) => {
  const uploadedFileName = req.file.originalname;
  const testName = req.file.filename;

  // Process the uploaded image
  const imagePath = path.join(__dirname, 'uploads', testName);
  
  /*gm(imagePath)
    .resize(300, 200) // Resize the image to 300x200 pixels
    .write(imagePath, (err) => {
      if (err) {
        console.error(err);
        res.send(`Error processing the image ${testName}`);
      } else {
        res.send(`Image '${testName}' uploaded and processed successfully!`);
      }
    });*/

  
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
