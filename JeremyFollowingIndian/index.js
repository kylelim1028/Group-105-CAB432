const express = require("express")
const multer = require("multer")
const imageSize = require("image-size")
const sharp = require("sharp")
const bodyParser = require("body-parser")
const fs = require("fs")
const path = require("path")
const AWS = require("aws-sdk");

var width
var format
var outputFilePath
var height


const app = express() 
app.use(bodyParser.urlencoded({extended:false}))
app.use(bodyParser.json())
app.use(express.static("public"));


var dir = "public";
var subDirectory = "public/uploads";

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);

  fs.mkdirSync(subDirectory);
}


var storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "public/uploads");
    },
    filename: function (req, file, cb) {
      cb(
        null,
        file.fieldname + "-" + Date.now() + path.extname(file.originalname)
      );
    },
  });
  
  const imageFilter = function (req, file, cb) {
    if (
      file.mimetype == "image/png" ||
      file.mimetype == "image/jpg" ||
      file.mimetype == "image/jpeg"
    ) {
      cb(null, true);
    } else {
      cb(null, false);
      return cb(new Error("Only .png, .jpg and .jpeg format allowed!"));
    }
  };
  
  var upload = multer({ storage: storage, fileFilter: imageFilter });
   

const PORT = process.env.PORT || 3000

// S3 setup
const bucketName = "group-105-bucket-kyle";
const s3 = new AWS.S3({ apiVersion: "2006-03-01" });

(async () => {
  try {
    await s3.createBucket({ Bucket: bucketName }).promise();
    console.log(`Created bucket: ${bucketName}`);
  } catch (err) {
    // We will ignore 409 errors which indicate that the bucket already exists
    if (err.statusCode !== 409) {
      console.log(`Error creating bucket: ${err}`);
    }
  }
})();


app.get("/",(req,res) => {
    res.sendFile(__dirname + "/index.html")
})


app.post("/processimage",upload.single("file"),(req,res) => {

    // format = req.body.format
    // width = parseInt(req.body.width)
    // height = parseInt(req.body.height)
    
    // if(req.file){
    //     console.log(req.file.path)

    //     if(isNaN(width) || isNaN(height)){

    //        var dimensions = imageSize(req.file.path)
    //        console.log(dimensions)
    //        width = parseInt(dimensions.width)
    //        height = parseInt(dimensions.height)
    //        processImage(width,height,req,res)

    //     }
    //     else{
    //         processImage(width,height,req,res)
    //     }
    // }

    if (req.file) {
      console.log(req.file.path);
      
      // Upload the raw image to S3
      uploadRawImage(req.file)
        .then((s3Key) => {
          res.json({ s3Key }); // Return the S3 key of the uploaded raw image
        })
        .catch((err) => {
          res.status(500).json({ error: err.message });
        });
    }
})


app.listen(PORT,() => {
    console.log(`App is listening on PORT ${PORT}`)
})


function processImage(width,height,req,res) {

    outputFilePath = Date.now() + "output." + format;

    if (req.file) {
        sharp(req.file.path)
          .resize(width, height)
          .toFile(outputFilePath, (err, info) => {
            if (err) throw err;
            res.download(outputFilePath, (err) => {
              if (err) throw err;
              fs.unlinkSync(req.file.path);
              fs.unlinkSync(outputFilePath);
            });
          });
      }
}

function uploadRawImage(file) {
  return new Promise((resolve, reject) => {
    const s3Key = `raw-images/${Date.now()}-${file.originalname}`;
    const body = fs.createReadStream(file.path);
    const params = { Bucket: bucketName, Key: s3Key, Body: body };

    s3.upload(params, (uploadErr, data) => {
      fs.unlinkSync(file.path);

      if (uploadErr) {
        reject(uploadErr);
      } else {
        resolve(s3Key);
      }
    });
  });
}