const express = require("express")
const multer = require("multer")
const imageSize = require("image-size")
const sharp = require("sharp")
const bodyParser = require("body-parser")
const fs = require("fs")
const path = require("path")
const AWS = require("aws-sdk");

var width // Image's width
var height // Image's height
var format // Image's format
var outputFilePath // Download file path
var baseImageKey // The S3 object's key

var imageBuffer

const PORT = process.env.PORT || 3000

const app = express() 
app.use(bodyParser.urlencoded({extended:false}))
app.use(bodyParser.json())
app.use(express.static("public"));


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
    console.log("Message sent to Queue")
  }
  catch (error)
  {
    console.log("Message not sent to queue")
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
    console.log("Message not deleted from queue");
  }
}

// Retrieves messages from the queue



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

var dir = "raw-images";
//var subDirectory = "public/uploads";

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
  //fs.mkdirSync(subDirectory);
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


// Uploading to the index page
app.get("/",(req,res) => {
    res.sendFile(__dirname + "/index.html") // Processed image goes here
})

// Uploading raw image to S3
// Sending message to SQS
app.post("/processimage",upload.single("file"),(req,res) => {

    format = req.body.format
    width = parseInt(req.body.width)
    height = parseInt(req.body.height)

    if (req.file) {
      //console.log(req.file.path);
      
      // Upload the raw image to S3
      uploadRawImage(req.file, format, width, height, false)
        .then((s3Key) => {
          res.json({ s3Key }); // Return the S3 key of the uploaded raw image

          sendMessageToQueue(`${s3Key}`) // Used to send SQS messages
          PollMessages(req,res); // Used to receive SQS messages
        
        })
        .catch((err) => {
          res.status(500).json({ error: err.message });
        });
    }
})

function uploadRawImage(file, format, width, height, isProcessed) {
  return new Promise((resolve, reject) => {

    let s3Key;

    if (!isProcessed) {
      s3Key = `raw-images/${width}x${height}-${file.originalname}`;
      
    }
    else {
      s3Key = `processed-images/output-${width}x${height}-${req.file.originalname}`;
    }

    const body = fs.createReadStream(file.path);

    // Metadata to hold format, width, and height
    const metadata = {
      "format" : `${format}`,
      "width" : `${width}`,
      "height" : `${height}`,
    };

    const params = { 
      Bucket: bucketName, 
      Key: s3Key, 
      Body: body,
      Metadata: metadata,
    };

    // Uploading
    s3.upload(params, (uploadErr, data) => {
      fs.unlinkSync(file.path);

      if (uploadErr) {
        reject(uploadErr);
      } else {
        resolve(s3Key);
        if(!isProcessed)
          console.log("Uploaded Raw to S3");
        else
          console.log("Uploaded Processes to S3")
      }
    });
  });
}

const PollMessages = async(req,res)=>
{
  try
  {
    const command = new ReceiveMessageCommand({
      MaxNumberOfMessages: 10,
      QueueUrl: queueURL,
      WaitTimeSeconds: 10,
      MessageAttribute: ['All'],
    });
    const result = await sqsClient.send(command);

    // If any messages available
    if (result.Messages && result.Messages.length > 0) {
      console.log("First Message in Queue: " + result.Messages[0].Body); // First message in the queue
      baseImageKey = result.Messages[0].Body; // Setting the S3 object's key

      // Retrieve the object from S3 bucket
      downloadRawImage(bucketName, baseImageKey, req, res)

      // Then delete the first message
      const del_result = await DeleteMessageFromQueue(result.Messages[0].ReceiptHandle)
      //console.log("Delete successful... " + result.Messages[0].ReceiptHandle);
    }
    
  }
  catch(error)
  {
    console.log(error);
  }
}
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
      //console.log("Object Metadata:", metadata);

      format = metadata.format;
      width = parseInt(metadata.width);
      height = parseInt(metadata.height);

      // Saving it to raw-images directory
      const localFilePath = __dirname + "/raw-images/" + baseImageKey.split("/").pop();
      fs.writeFileSync(localFilePath, imageBuffer);
      console.log("Image Downloaded to", localFilePath);

      const savedFile = fs.readFile(localFilePath, (err, data) => {
          if(err)
          {
            console.error(`Error reading file ${err}`);
            return;
          }
      });
      console.log(savedFile);
      readingImageData(format, width, height, savedFile, res);
    }
  });

  // Upload the processed image to S3 
}

// Reads the image data
function readingImageData(format, width, height, image, res) {

    if(image){
        console.log(image.file.path)

        if(isNaN(width) || isNaN(height)){

           var dimensions = imageSize(image.file.path)
           //console.log(dimensions)
           width = parseInt(dimensions.width)
           height = parseInt(dimensions.height)
           processImage(format, width, height, image, res) // Start processing the image

        }
        else{
            processImage(format, width, height, image, res) // Start processing the image
        }
    }
    else {
      console.log("NO REQ FILE");
      console.log(image)
    }
}

// Processes the image
function processImage(format, width, height, req, res) {

  outputFilePath = `processed-images/output-${width}x${height}-${req.file.originalname}`

  // Processes the image
  if (req.file) {
      sharp(path.join(__dirname, "raw-images", baseImageKey.split("/").pop()))
        .resize(width, height)
        .toFile(outputFilePath, (err, info) => {
          if (err) throw err;

          // Downloads the image
          res.download(outputFilePath, (err) => {
            console.log("PROCESSED IMAGE");
            
            uploadRawImage(outputFilePath, format, width, height, true)
            .then((s3Key) => {
              res.json({ s3Key }); // Return the S3 key of the uploaded raw image
            })
            .catch((err) => {
              console.log("ASS");
              res.status(500).json({ error: err.message });
            });
          
            console.log("HOE");
          });
        });
    }
}

// Uploading the raw image to S3 bucket


// Downloading the raw image from S3



app.listen(PORT,() => {
  console.log(`App is listening on PORT ${PORT}`)
})