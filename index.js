var fs = require('fs')
  , gm = require('gm');

// resize and remove EXIF profile data
gm('C:\Users\cubeo\OneDrive\Documents\Uni\Sem_6\CAB432\Assessment 2\kittens.jpg')
.resize(240, 240)
.noProfile()
.write('C:\Users\cubeo\OneDrive\Documents\Uni\Sem_6\CAB432\Assessment 2\kittens.jpg', function (err) {
  if (!err) console.log('done');
});
