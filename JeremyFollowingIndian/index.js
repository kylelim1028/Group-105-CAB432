const express = require("express")
const multer = require("multer")
const imageSize = require("image-size")
const sharp = require("sharp")
const bodyParser = require("body-parser")
const fs = require("fs")
const path = require("path")
const AWS = require("aws-sdk")
const redis = require('redis');

var width // Images width
var height // Images height
var format // Images format
var outputFilePath // Download file path
var baseImageKey // The S3 objects key

var imageBuffer

const PORT = process.env.PORT || 3000

// Set the AWS region
AWS.config.update({ region: "ap-southeast-2" });

const app = express() 
app.use(bodyParser.urlencoded({extended:false}))
app.use(bodyParser.json())
app.use(express.static("public"));

app.set('view engine', 'hbs');

// SQS can send, receive, and delete messages
const {SQSClient,
       SendMessageCommand,
       ReceiveMessageCommand,
        DeleteMessageCommand} = require("@aws-sdk/client-sqs");
const {configObject} = require("./credentials");
const {} = require("sqs-consumer");

const sqsClient = new SQSClient(configObject);
const queueURL = "https://sqs.ap-southeast-2.amazonaws.com/901444280953/actual-cab432-group105"

// Sends message to the queue, used for S3 object keys
const sendMessageToQueue = async(body)=>
{
  try {
    const command = new SendMessageCommand({
      MessageBody: body, 
      QueueUrl : queueURL,
      MessageAttribute : {
        OrderID: {DataType: "String", StringValue: "4421x"},
      },
    });
    const result = await sqsClient.send(command)
    console.log("SQS Send")
  }
  catch (error)
  {
    console.log(error, "oh no")
  }
}

// Deletes messages from the queue, ensures a single instance
const DeleteMessageFromQueue = async (ReceiptHandle)=>
{
  try {
    const data = await sqsClient.send(new DeleteMessageCommand({
      QueueUrl:queueURL,
      ReceiptHandle: ReceiptHandle
    }))
  } catch (error) {
    console.log(error);
  }
}

// Retrieves messages from the queue
const PollMessages = async(req,res)=>
{
  try
  {
    const command = new ReceiveMessageCommand({
      MaxNumberOfMessages: 10,
      QueueUrl: queueURL,
      WaitTimeSeconds: 10,
      MessageAttribute: ["All"],
    });
    const result = await sqsClient.send(command);
    console.log("SQS POLL 1")

    // If any messages available
    if (result.Messages && result.Messages.length > 0) {
      console.log("First Message in Queue: " + result.Messages[0].Body); // First message in the queue
      baseImageKey = result.Messages[0].Body; // Setting the S3 objects key
      console.log(baseImageKey, " SQS POLL 2")

      // Retrieve the object from S3 bucket
      downloadRawImage(bucketName, baseImageKey, req, res)
      console.log("SQS POLL 3")

      // Then delete the first message
      const del_result = await DeleteMessageFromQueue(result.Messages[0].ReceiptHandle)
    }
    
  }
  catch(error)
  {
    console.log(error);
  }
}


/*const autoQueueHandler = Consumer.create({
  queueURL: queueURL,
  sqs: sqsClient,
  handleMessage: async(message) => 
  {
    console.log(message);
  },
});

autoQueueHandler.on("processing_error", (err) =>
{
  console.log(err);
});

autoQueueHandler.start();
*/

var dir = "public";
var subDirectory = "public/uploads";

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
  fs.mkdirSync(subDirectory);
}

var storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, "raw-images");
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
   

// S3 setup
const bucketName = "group-105-bucket-kyle";
const s3 = new AWS.S3({ apiVersion: "2006-03-01" });

(async () => {
  try {
    await s3.createBucket({ Bucket: bucketName }).promise();
    console.log(`Created bucket: ${bucketName}`);
  } catch (err) {
    // Ignore 409 errors which indicate that the bucket already exists
    if (err.statusCode !== 409) {
      console.log(`Error creating bucket: ${err}`);
    }
  }
})();


// Redis setup
const redisClient = redis.createClient({
  host: "localhost",
  port: 6379,
});  
(async () => {
  try {
    await  redisClient.connect();  
  } catch (err) {
    console.log(err);
  }
})();


// Uploading to the index page
app.get("/",(req,res) => {
  res.render("index") // Processed image goes here
})


// Uploading raw image to S3
// Sending message to SQS
app.post("/processimage",upload.single("file"),(req,res) => {

    format = req.body.format
    width = parseInt(req.body.width)
    height = parseInt(req.body.height)

    redisKey = `processed-images/output-${width}x${height}-${req.file.originalname}`
    console.log(redisKey)

    // Check Redis cache
    const result = redisClient.get(redisKey);

    if (result) {
      console.log("FOUND IN REDIS")
      res.redirect(`/results?tempPath=${redisKey}`)
      return;
    }

    else {
      if (req.file) {
        //console.log(req.file.path);
        
        const rawImageKey = `raw-images/${width}x${height}-${req.file.originalname}`;
        console.log(rawImageKey, " FAKE KEY")
        //SQS_Stuff(req, res, rawImageKey)
  
        // Upload the raw image to S3
        uploadRawImage(req.file, format, width, height, false)
          .then((rawImageKey) => {          
            //console.log(s3Key, " S3 KEY")
            SQS_Stuff(req, res, rawImageKey);
          
          })
          .catch((err) => {
            res.status(500).json({ error: err.message });
          });
      }
    }    
})


function SQS_Stuff(req, res, rawImageKey) {
  console.log("SQS Start")
  sendMessageToQueue(`${rawImageKey}`) // Used to send SQS messages
  PollMessages(req,res); // Used to receive SQS messages
}


// Reads the image data
function readingImageData(format, width, height, req, res, baseImageKey) {

    rawImagePath = path.join(__dirname, "raw-images", baseImageKey.split("/").pop());

    if(rawImagePath){
        //console.log(req.file.path)

        if(isNaN(width) || isNaN(height)){

           var dimensions = imageSize(rawImagePath)
           console.log(dimensions)
           width = parseInt(dimensions.width)
           height = parseInt(dimensions.height)
           processImage(format, width, height, req, res, rawImagePath) // Start processing the image

        }
        else{
          processImage(format, width, height, req, res, rawImagePath) // Start processing the image
        }
    }
    else {
      console.log("NO REQ FILE");
    }
}

// Processes the image
function processImage(format, width, height, req, res, rawImagePath) {
  console.log(Date.now(), "0")
  outputFilePath = `processed-images/output-${path.basename(rawImagePath)}`;

  // Processes the image
  if (rawImagePath) {
    sharp(rawImagePath)
      .resize(width, height)
      .toFile(outputFilePath, (err, info) => {
        if (err) {
          console.error(err);
          res.status(500).json({ error: err.message }); // Send an error response
        } 
        
        else {
          console.log("PROCESSED IMAGE");

          // Upload the processed image to S3
          uploadRawImage(outputFilePath, format, width, height, true, outputFilePath, res)

          // Store in Redis cache
          redisKey = outputFilePath;
          redisClient.setEx(
            redisKey,
            3600,
            JSON.stringify({ source: "Redis Cache", ...outputFilePath })
          )

          console.log(Date.now(), "1")
        }
      });
  } 
  
  else {
    console.log("NO REQ FILE");
    res.status(400).json({ error: "Image not found." });
  }
}

// Uploading the raw image to S3 bucket
function uploadRawImage(file, format, width, height, isProcessed, outputFilePath, res) {
  return new Promise((resolve, reject) => {

    let s3Key;
    let params;

    // If not processed (raw image)
    if (!isProcessed) {
      s3Key = `raw-images/${width}x${height}-${file.originalname}`;
      const body = fs.createReadStream(file.path);

      // Metadata to hold format, width, and height
      const metadata = {
        "format" : `${format}`,
        "width" : `${width}`,
        "height" : `${height}`,
      };

      params = { 
        Bucket: bucketName, 
        Key: s3Key, 
        Body: body,
        Metadata: metadata,
      };
    }

    // Image has been processed already
    else {
      s3Key = `processed-images/output-${path.basename(rawImagePath)}`;
      const body = fs.createReadStream(file);

      params = { 
        Bucket: bucketName, 
        Key: s3Key, 
        Body: body,
      };
    }

    // Uploading
    s3.upload(params, (uploadErr, data) => {

      if (!isProcessed) {
        fs.unlinkSync(file.path);
      }

      if (uploadErr) {
        reject(uploadErr);
      } else {
        resolve(s3Key);
        console.log("UPLOADED TO S3");
        
        if (isProcessed) {
          res.redirect(`/results?tempPath=${outputFilePath}`)
        }
        
      }
    });
  });
}

// Downloading the raw image from S3
function downloadRawImage(bucketName, baseImageKey, req, res) {
  const params = {
    Bucket: bucketName,
    Key: baseImageKey,
  };

  // Downloading
  s3.getObject(params, (err, data) => {
    if (err) {
      console.error(err);
    } else {
      imageBuffer = data.Body;
      const metadata = data.Metadata;
      console.log("Object Metadata:", metadata);

      format = metadata.format;
      width = parseInt(metadata.width);
      height = parseInt(metadata.height);

      // Saving it to raw-images directory
      const localFilePath = __dirname + "/raw-images/" + baseImageKey.split("/").pop();
      fs.writeFileSync(localFilePath, imageBuffer);
      console.log("Image Downloaded to", localFilePath);

      readingImageData(format, width, height, req, res, baseImageKey);
    }
  });
}


app.get("/results", async (req, res) => {

  outputFilePath = req.query.tempPath;
  //console.log(outputFilePath, " GGGGGGGGGGGGGGG");
  //console.log(bucketName);
  console.log(Date.now(), "2")

  // Check Redis cache
  const result = await redisClient.get(outputFilePath);
  console.log(Date.now(), "3")
  // If in Redis Cache
  if (result) {
    console.log(Date.now(), "4")
    const params = {
      Bucket: bucketName,
      Key: outputFilePath,
    }
  
    var dataURL
  
    // Download from S3
    s3.getObject(params, (err, data) => {
      if (err) {
        console.error(err);
      } 
      
      else {
        // Convert the image buffer to a data URL
        const contentType = data.ContentType;
        const imageBuffer = data.Body;
        dataURL = `https://${bucketName}.s3.ap-southeast-2.amazonaws.com/${outputFilePath}`;
        console.log(dataURL);
  
        res.render("results", {dataURL})
      }
    });  
  };
  
})



app.listen(PORT,() => {
  console.log(`App is listening on PORT ${PORT}`)
})