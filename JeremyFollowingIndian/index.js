const express = require("express")
const multer = require("multer")
const imageSize = require("image-size")
const sharp = require("sharp")
const bodyParser = require("body-parser")
const fs = require("fs")
const path = require("path")
const AWS = require("aws-sdk");

var width
var height
var format
var outputFilePath


const app = express() 
app.use(bodyParser.urlencoded({extended:false}))
app.use(bodyParser.json())
app.use(express.static("public"));


//SQS Stuff
const {SQSClient,
       SendMessageCommand,
       ReceiveMessageCommand,
        DeleteMessageCommand} = require("@aws-sdk/client-sqs");
const {configObject} = require("./credentials");
const {} = require("sqs-consumer");

const sqsClient = new SQSClient(configObject);
const queueURL = "https://sqs.ap-southeast-2.amazonaws.com/901444280953/cab432_group105"

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
    console.log(result, "success");
  }
  catch (error) //current issue
  {
    console.log(error, "oh no")
  }
}

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

const PollMessages = async()=>
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
    console.log(result.Messages);

    //Do some computation

    //Then delete it
    const del_result = await DeleteMessageFromQueue(result.Messages[0].ReceiptHandle) //Delete the first message from Q
    console.log("Delete successful...");
  }
  catch(error)
  {
    console.log(error);
  }
}

//setInterval(PollMessages, 1000) //Do every 1 second
//PollMessages(); - Used to receive SQS messages
//sendMessageToQueue("First Message from Node") - Used to send SQS messages

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

    format = req.body.format
    width = parseInt(req.body.width)
    height = parseInt(req.body.height)
    
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
      uploadRawImage(req.file, format, width, height)
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

function uploadRawImage(file, format, width, height) {
  return new Promise((resolve, reject) => {
    const s3Key = `raw-images/${Date.now()}-${file.originalname}`;
    const body = fs.createReadStream(file.path);
    
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
