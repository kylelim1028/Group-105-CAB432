/*
% Copyright (C) 2003-2020 GraphicsMagick Group
% Copyright (C) 2002 ImageMagick Studio
% Copyright 1991-1999 E. I. du Pont de Nemours and Company
%
% This program is covered by multiple licenses, which are described in
% Copyright.txt. You should have received a copy of Copyright.txt with this
% package; otherwise see http://www.graphicsmagick.org/www/Copyright.html.
%
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%                                                                             %
%                                                                             %
%                                                                             %
%                            RRRR   L      EEEEE                              %
%                            R   R  L      E                                  %
%                            RRRR   L      EEE                                %
%                            R R    L      E                                  %
%                            R  R   LLLLL  EEEEE                              %
%                                                                             %
%                                                                             %
%                         Read URT RLE Image Format.                          %
%                                                                             %
%                                                                             %
%                              Software Design                                %
%                                John Cristy                                  %
%                                 July 1992                                   %
%                                                                             %
%                                                                             %
%                                                                             %
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%
*/

/*
  Include declarations.
*/
#include "magick/studio.h"
#include "magick/attribute.h"
#include "magick/blob.h"
#include "magick/colormap.h"
#include "magick/log.h"
#include "magick/magick.h"
#include "magick/monitor.h"
#include "magick/pixel_cache.h"
#include "magick/utility.h"

typedef struct _RLE_Header
{
  magick_uint8_t   Magic[2];    /* Magic number */
  magick_uint16_t  Xpos;        /* Lower left x of image */
  magick_uint16_t  Ypos;        /* Lower left y of image */
  magick_uint16_t  XSize;       /* Image width */
  magick_uint16_t  YSize;       /* Image height */
  magick_uint8_t   Flags;       /* Misc flags */
  magick_uint8_t   Ncolors;     /* Number of colors */
  magick_uint8_t   Pixelbits;   /* Number of bits per channel */
  magick_uint8_t   Ncmap;       /* Number of color channels in palette */
  magick_uint8_t   Cmaplen;     /* Colormap length */

} RLE_HEADER;

/* If this flag is set, the image rectangle should first be cleared to
the background color (q.v.) before reading the scanline data. */
#define ClearFirstFlag    0x01

/* If this flag is set, no background color is supplied, and the
ClearFirst flag should be ignored. */
#define NoBackgroundFlag  0x02

/* This flag indicates the presence of an "alpha" channel. The alpha
channel is used by image compositing software to correctly blend
anti-aliased edges. It is stored as channel -1 (255). */
#define AlphaFlag         0x04

/* If this flag is set, comments are present in the variable part of
the header, immediately following the color map. */
#define CommentsFlag      0x08

/* RLE operators */
#define SkipLinesOp  0x01
#define SetColorOp  0x02
#define SkipPixelsOp  0x03
#define ByteDataOp  0x05
#define RunDataOp  0x06
#define EOFOp  0x07

static void LogRLEHeader(const RLE_HEADER* rle_header)
{
  (void) LogMagickEvent(CoderEvent,GetMagickModule(),
                        "RLE Header\n"
                        "    Magic:     \\%03o\\%03o\n"
                        "    Xpos:      %u\n"
                        "    Ypos:      %u\n"
                        "    XSize:     %u\n"
                        "    YSize:     %u\n"
                        "    Flags:     0x%02x (%u,%u,%u,%u,%u,%u,%u,%u)\n"
                        "    Ncolors:   %u\n"
                        "    Pixelbits: %u\n"
                        "    Ncmap:     %u\n"
                        "    Cmaplen:   %u",
                        rle_header->Magic[0],
                        rle_header->Magic[1],
                        rle_header->Xpos,
                        rle_header->Ypos,
                        rle_header->XSize,
                        rle_header->YSize,
                        rle_header->Flags,
                        (rle_header->Flags >> 7) & 0x01,
                        (rle_header->Flags >> 6) & 0x01,
                        (rle_header->Flags >> 5) & 0x01,
                        (rle_header->Flags >> 4) & 0x01,
                        (rle_header->Flags >> 3) & 0x01,
                        (rle_header->Flags >> 2) & 0x01,
                        (rle_header->Flags >> 1) & 0x01,
                        (rle_header->Flags >> 0) & 0x01,
                        rle_header->Ncolors,
                        rle_header->Pixelbits,
                        rle_header->Ncmap,
                        rle_header->Cmaplen);
}

/*
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%                                                                             %
%                                                                             %
%                                                                             %
%   I s R L E                                                                 %
%                                                                             %
%                                                                             %
%                                                                             %
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%  Method IsRLE returns True if the image format type, identified by the
%  magick string, is RLE.
%
%  The format of the ReadRLEImage method is:
%
%      unsigned int IsRLE(const unsigned char *magick,const size_t length)
%
%  A description of each parameter follows:
%
%    o status:  Method IsRLE returns True if the image format type is RLE.
%
%    o magick: This string is generally the first few bytes of an image file
%      or blob.
%
%    o length: Specifies the length of the magick string.
%
%
*/
static unsigned int IsRLE(const unsigned char *magick,const size_t length)
{
  if (length < 2)
    return(False);
  if (memcmp(magick,"\122\314",2) == 0)
    return(True);
  return(False);
}

/*
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%                                                                             %
%                                                                             %
%                                                                             %
%   R e a d R L E I m a g e                                                   %
%                                                                             %
%                                                                             %
%                                                                             %
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%  Method ReadRLEImage reads a run-length encoded Utah Raster Toolkit
%  image file and returns it.  It allocates the memory necessary for the new
%  Image structure and returns a pointer to the new image.
%
%  The format of the ReadRLEImage method is:
%
%      Image *ReadRLEImage(const ImageInfo *image_info,ExceptionInfo *exception)
%
%  A description of each parameter follows:
%
%    o image:  Method ReadRLEImage returns a pointer to the image after
%      reading.  A null image is returned if there is a memory shortage or
%      if the image cannot be read.
%
%    o image_info: Specifies a pointer to a ImageInfo structure.
%
%    o exception: return any errors or warnings in this structure.
%
%
*/
#define ThrowRLEReaderException(code_,reason_,image_) \
do { \
  MagickFreeResourceLimitedMemory(colormap); \
  MagickFreeResourceLimitedMemory(rle_pixels); \
  ThrowReaderException(code_,reason_,image_); \
} while (0);
static Image *ReadRLEImage(const ImageInfo *image_info,ExceptionInfo *exception)
{
  RLE_HEADER
    rle_header;

  Image
    *image;

  int
    opcode,
    operand,
    pixel,
    status;

  size_t
    colormap_entries;

  unsigned int
    index;

  unsigned long
    y;

  register IndexPacket
    *indexes;

  register unsigned long
    x;

  register PixelPacket
    *q;

  register unsigned int
    i;

  register unsigned char
    *p;

  size_t
    count,
    map_length,
    number_pixels,
    offset,
    rle_bytes;

  unsigned char
    background_color[256],
    *colormap = (unsigned char *) NULL,
    plane,
    *rle_pixels = (unsigned char *) NULL;

  unsigned int
    number_colormaps,
    number_planes;

  magick_off_t
    file_size;

  /*
    Open image file.
  */
  assert(image_info != (const ImageInfo *) NULL);
  assert(image_info->signature == MagickSignature);
  assert(exception != (ExceptionInfo *) NULL);
  assert(exception->signature == MagickSignature);
  (void) memset(&rle_header,0,sizeof(rle_header));
  image=AllocateImage(image_info);
  status=OpenBlob(image_info,image,ReadBinaryBlobMode,exception);
  if (status == False)
    ThrowRLEReaderException(FileOpenError,UnableToOpenFile,image);
  /*
    Determine if this is a RLE file.
  */
  count=ReadBlob(image,2,(char *) &rle_header.Magic);
  if ((count != 2) || (memcmp(&rle_header.Magic,"\122\314",2) != 0))
    ThrowRLEReaderException(CorruptImageError,ImproperImageHeader,image);
  file_size=GetBlobSize(image);
  /*
    Read image header.
  */
  rle_header.Xpos=ReadBlobLSBShort(image);
  rle_header.Ypos=ReadBlobLSBShort(image);
  rle_header.XSize=ReadBlobLSBShort(image);
  rle_header.YSize=ReadBlobLSBShort(image);
  rle_header.Flags=ReadBlobByte(image);
  rle_header.Ncolors=ReadBlobByte(image);
  rle_header.Pixelbits=ReadBlobByte(image);
  rle_header.Ncmap=ReadBlobByte(image);
  rle_header.Cmaplen=ReadBlobByte(image);
  if (EOFBlob(image))
    ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);

  LogRLEHeader(&rle_header);

  if ((rle_header.Ncolors == 0) ||
      (rle_header.Ncolors == 2) ||
      ((rle_header.Flags & AlphaFlag) &&
       ((rle_header.Ncolors > 254) || (rle_header.Ncolors < 3))) ||
      (rle_header.Pixelbits != 8))
    ThrowRLEReaderException(CoderError,DataEncodingSchemeIsNotSupported,image);

  /* X/Y size may not be zero and may not exceed 32768 */
  if ((rle_header.XSize == 0) || (rle_header.XSize >= 32768) ||
      (rle_header.YSize == 0) || (rle_header.YSize >= 32768))
    ThrowRLEReaderException(CorruptImageError,ImproperImageHeader,image);

  if (rle_header.Cmaplen > 8)
    ThrowRLEReaderException(CorruptImageError,ImproperImageHeader,image);

  image->columns=rle_header.XSize;
  image->rows=rle_header.YSize;
  image->matte=rle_header.Flags & AlphaFlag;
  number_planes=rle_header.Ncolors;
  number_colormaps=rle_header.Ncmap;
  map_length=(size_t) 1 << rle_header.Cmaplen;

  (void) memset(background_color,0,sizeof(background_color));
  if (rle_header.Flags & NoBackgroundFlag)
    {
      /*
        No background color-- initialize to black.
      */
      for (i=0; i < number_planes; i++)
        background_color[i]=0;
      (void) ReadBlobByte(image);
    }
  else
    {
      /*
        Initialize background color.
      */
      p=background_color;
      for (i=0; i < number_planes; i++)
        *p++=ReadBlobByte(image);
    }
  if ((number_planes & 0x01) == 0)
    (void) ReadBlobByte(image);

  if (EOFBlob(image))
    ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);

  if (image->matte)
    number_planes++;

  /*
    Rationalize pixels with file size
  */
  if ((file_size == 0) ||
      ((((double) image->columns*image->rows*number_planes*
         rle_header.Pixelbits/8)/file_size) > 254.0))
    ThrowRLEReaderException(CorruptImageError,InsufficientImageDataInFile,
                            image);

  if ((double) number_colormaps*map_length > file_size)
    ThrowRLEReaderException(CorruptImageError,InsufficientImageDataInFile,
                            image);

  /*
    Cap the number of planes at 4 since we don't support more than that.
  */
  if (number_planes > 4)
    number_planes=4;

  colormap_entries=0;
  if (number_colormaps != 0)
    {
      /*
        Read image colormaps.  Color map values are stored as 16 bit
        quantities, left justified in the word.
      */
      colormap=MagickAllocateResourceLimitedArray(unsigned char *,number_colormaps,
                                   map_length);
      if (colormap == (unsigned char *) NULL)
        ThrowRLEReaderException(ResourceLimitError,MemoryAllocationFailed,
                                image);
      p=colormap; /* unsigned char * */
      for (i=0; i < number_colormaps; i++)
        for (x=0; x < map_length; x++)
          {
            if (EOFBlob(image))
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,
                                      image);
            *p++=(ReadBlobLSBShort(image) >> 8);
          }
      colormap_entries=MagickArraySize(number_colormaps,map_length);
    }
  if (rle_header.Flags & CommentsFlag)
    {
      char
        *comment;

      unsigned int
        length;

      /*
        Read image comment.

        The comment block contains any number of null-terminated
        text strings. These strings will conventionally be of the
        form "name=value", allowing for easy retrieval of specific
        information. However, there is no restriction that a given
        name appear only once, and a comment may contain an
        arbitrary string.
      */
      length=ReadBlobLSBShort(image);
      comment=MagickAllocateResourceLimitedMemory(char *,(size_t) length+1);
      if (comment == (char *) NULL)
        {
          (void) LogMagickEvent(CoderEvent,GetMagickModule(),
                                "Failed to allocate %u bytes for comment",
                                length+1);
          ThrowRLEReaderException(ResourceLimitError,MemoryAllocationFailed,
                                  image);
        }
      if (ReadBlob(image,length,comment) != length)
        {
          MagickFreeResourceLimitedMemory(comment);
          ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
        }
      comment[length]='\0';
      /*
        Delimit multiple comments with '\n' so they fit in one string.
      */
      if (length)
        for (i=0; i < length-1; i++)
          {
            if (comment[i]=='\0')
              comment[i]='\n';
          }
      (void) SetImageAttribute(image,"comment",comment);
      (void) LogMagickEvent(CoderEvent,GetMagickModule(),
                            "Comment: '%s'", comment);
      MagickFreeResourceLimitedMemory(comment);
      if ((length & 0x01) == 0)
        (void) ReadBlobByte(image);
    }

  if (EOFBlob(image))
    ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);

  if (image_info->ping)
    {
      MagickFreeResourceLimitedMemory(colormap);
      CloseBlob(image);
      StopTimer(&image->timer);
      return(image);
    }

  if (CheckImagePixelLimits(image, exception) != MagickPass)
    ThrowRLEReaderException(ResourceLimitError,ImagePixelLimitExceeded,image);

  /*
    Allocate RLE pixels.
  */
  number_pixels=MagickArraySize(image->columns,image->rows);
  rle_bytes=MagickArraySize(number_pixels,number_planes);
  if ((number_pixels == 0) || (rle_bytes == 0))
    ThrowRLEReaderException(ResourceLimitError,MemoryAllocationFailed,image);
  rle_pixels=MagickAllocateResourceLimitedArray(unsigned char *,number_pixels,
                                 number_planes);
  if (rle_pixels == (unsigned char *) NULL)
    ThrowRLEReaderException(ResourceLimitError,MemoryAllocationFailed,image);
  (void) memset(rle_pixels,0,rle_bytes);
  if ((rle_header.Flags & ClearFirstFlag) &&
      !(rle_header.Flags & NoBackgroundFlag))
    {
      int
        j;

      /*
        Set background color.
      */
      p=rle_pixels;
      for (i=0; i < number_pixels; i++)
        {
          if (!image->matte)
            for (j=0; j < (int) number_planes; j++)
              *p++=background_color[j];
          else
            {
              for (j=0; j < ((int) number_planes-1); j++)
                *p++=background_color[j];
              *p++=0;  /* initialize matte channel */
            }
        }
    }
  /*
    Read runlength-encoded image.
  */
  plane=0;
  x=0;
  y=0;
  opcode=ReadBlobByte(image);
  if (opcode == EOF)
    ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
  do
    {
      switch (opcode & 0x3f)
        {
        case SkipLinesOp:
          {
            operand=ReadBlobByte(image);
            if (operand == EOF)
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
            if (opcode & 0x40)
              {
                operand=ReadBlobLSBShort(image);
                if (EOFBlob(image))
                  ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
              }
            x=0;
            y+=operand;
            break;
          }
        case SetColorOp:
          {
            operand=ReadBlobByte(image);
            if (operand == EOF)
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
            plane=(unsigned char) operand;
            if (plane == 255)
              plane=(unsigned char) (number_planes-1);
            x=0;
            break;
          }
        case SkipPixelsOp:
          {
            operand=ReadBlobByte(image);
            if (operand == EOF)
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
            if (opcode & 0x40)
              {
                operand=ReadBlobLSBShort(image);
                if (EOFBlob(image))
                  ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
              }
            x+=operand;
            break;
          }
        case ByteDataOp:
          {
            operand=ReadBlobByte(image);
            if (operand == EOF)
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
            if (opcode & 0x40)
              {
                operand=ReadBlobLSBShort(image);
                if (EOFBlob(image))
                  ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
              }
            offset=(((size_t) image->rows-y-1)*image->columns*number_planes)+x*(size_t) number_planes+plane;
            operand++;
            if ((SIZE_MAX - (size_t) rle_pixels) < offset)
              ThrowRLEReaderException(CorruptImageError,UnableToRunlengthDecodeImage,image);
            p=rle_pixels+offset;
            for (i=0; i < (unsigned int) operand; i++)
              {
                pixel=ReadBlobByte(image);
                if (pixel == EOF)
                  ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
                if ((p >= rle_pixels) && (p < rle_pixels+rle_bytes))
                  *p=(unsigned char) pixel;
                else
                  ThrowRLEReaderException(CorruptImageError,UnableToRunlengthDecodeImage,image);
                p+=number_planes;
              }
            if (operand & 0x01)
              (void) ReadBlobByte(image);
            x+=operand;
            break;
          }
        case RunDataOp:
          {
            operand=ReadBlobByte(image);
            if (operand == EOF)
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
            if (opcode & 0x40)
              {
                operand=ReadBlobLSBShort(image);
                if (EOFBlob(image))
                  ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
              }
            pixel=ReadBlobByte(image);
            if (pixel == EOF)
              ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
            (void) ReadBlobByte(image);
            operand++;
            offset=(((size_t) image->rows-y-1)*image->columns*number_planes)+x*(size_t) number_planes+plane;
            if ((SIZE_MAX - (size_t) rle_pixels) < offset)
              ThrowRLEReaderException(CorruptImageError,UnableToRunlengthDecodeImage,image);
            p=rle_pixels+offset;
            for (i=0; i < (unsigned int) operand; i++)
              {
                if ((p >= rle_pixels) && (p < rle_pixels+rle_bytes))
                  *p=pixel;
                else
                  ThrowRLEReaderException(CorruptImageError,UnableToRunlengthDecodeImage,image);
                p+=number_planes;
              }
            x+=operand;
            break;
          }
        default:
          break;
        }
      opcode=ReadBlobByte(image);
      if (opcode == EOF)
        ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
    } while (((opcode & 0x3f) != EOFOp) && (opcode != EOF));
  if (number_colormaps != 0)
    {
      unsigned int
        mask;

      /*
        Apply colormap affineation to image.
      */
      mask=(unsigned int) (map_length-1);
      p=rle_pixels;
      if (number_colormaps == 1)
        for (i=0; i < number_pixels; i++)
          {
            index=*p & mask;
            VerifyColormapIndexWithColors(image,index,colormap_entries);
            *p=colormap[index];
            p++;
          }
      else
        if ((number_planes >= 3) && (number_colormaps >= 3))
          for (i=0; i < number_pixels; i++)
            for (x=0; x < number_planes; x++)
              {
                index=x*(unsigned int) map_length+(*p & mask);
                VerifyColormapIndexWithColors(image,index,colormap_entries);
                *p=colormap[index];
                p++;
              }
    }
  /*
    Initialize image structure.
  */
  if (number_planes >= 3)
    {
      /*
        Convert raster image to DirectClass pixel packets.
      */
      p=rle_pixels;
      for (y=0; y < image->rows; y++)
        {
          q=SetImagePixels(image,0,y,image->columns,1);
          if (q == (PixelPacket *) NULL)
            break;
          for (x=0; x < image->columns; x++)
            {
              q->red=ScaleCharToQuantum(*p++);
              q->green=ScaleCharToQuantum(*p++);
              q->blue=ScaleCharToQuantum(*p++);
              if (image->matte)
                q->opacity=(Quantum) (MaxRGB-ScaleCharToQuantum(*p++));
              q++;
            }
          if (!SyncImagePixels(image))
            break;
          if (image->previous == (Image *) NULL)
            if (QuantumTick(y,image->rows))
              if (!MagickMonitorFormatted(y,image->rows,exception,
                                          LoadImageText,image->filename,
            image->columns,image->rows))
                break;
        }
    }
  else
    {
      /*
        Create colormap.
      */
      if (number_colormaps == 0)
        map_length=256;
      if (((unsigned long) map_length != map_length) ||
          (!AllocateImageColormap(image,(unsigned long) map_length)))
        ThrowRLEReaderException(ResourceLimitError,MemoryAllocationFailed,
                                image);
      p=colormap;
      if (number_colormaps == 1)
        for (i=0; i < image->colors; i++)
          {
            /*
              Pseudocolor.
            */
            image->colormap[i].red=ScaleCharToQuantum(i);
            image->colormap[i].green=ScaleCharToQuantum(i);
            image->colormap[i].blue=ScaleCharToQuantum(i);
          }
      else
        if (number_colormaps > 1)
          for (i=0; i < image->colors; i++)
            {
              image->colormap[i].red=ScaleCharToQuantum(*p);
              image->colormap[i].green=ScaleCharToQuantum(*(p+map_length));
              if (number_colormaps > 2)
                image->colormap[i].blue=ScaleCharToQuantum(*(p+map_length*2));
              else
                image->colormap[i].blue=0U;
              p++;
            }
      p=rle_pixels;
      if (!image->matte)
        {
          /*
            Convert raster image to PseudoClass pixel packets.
          */
          for (y=0; y < image->rows; y++)
            {
              q=SetImagePixels(image,0,y,image->columns,1);
              if (q == (PixelPacket *) NULL)
                break;
              indexes=AccessMutableIndexes(image);
              for (x=0; x < image->columns; x++)
                indexes[x]=(*p++);
              if (!SyncImagePixels(image))
                break;
              if (image->previous == (Image *) NULL)
                if (QuantumTick(y,image->rows))
                  if (!MagickMonitorFormatted(y,image->rows,exception,
                                              LoadImageText,image->filename,
                image->columns,image->rows))
                    break;
            }
          (void) SyncImage(image);
        }
      else
        {
          /*
            Image has a matte channel-- promote to DirectClass.
          */
          for (y=0; y < image->rows; y++)
            {
              q=SetImagePixels(image,0,y,image->columns,1);
              if (q == (PixelPacket *) NULL)
                break;
              for (x=0; x < image->columns; x++)
                {
                  index=*p++;
                  VerifyColormapIndex(image,index);
                  q->red=image->colormap[index].red;
                  index=*p++;
                  VerifyColormapIndex(image,index);
                  q->green=image->colormap[index].green;
                  index=*p++;
                  VerifyColormapIndex(image,index);
                  q->blue=image->colormap[index].blue;
                  q->opacity=(Quantum) (MaxRGB-ScaleCharToQuantum(*p++));
                  q++;
                }
              if (!SyncImagePixels(image))
                break;
              if (image->previous == (Image *) NULL)
                if (QuantumTick(y,image->rows))
                  if (!MagickMonitorFormatted(y,image->rows,exception,
                                              LoadImageText,
                                              image->filename,
                image->columns,image->rows))
                    break;
            }
          MagickFreeMemory(image->colormap);
          image->colormap=(PixelPacket *) NULL;
          image->storage_class=DirectClass;
          image->colors=0;
        }
    }
  MagickFreeResourceLimitedMemory(colormap);
  MagickFreeResourceLimitedMemory(rle_pixels);
  if (EOFBlob(image))
    {
      ThrowRLEReaderException(CorruptImageError,UnexpectedEndOfFile,image);
    }
  CloseBlob(image);
  StopTimer(&image->timer);
  return(image);
}

/*
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%                                                                             %
%                                                                             %
%                                                                             %
%   R e g i s t e r R L E I m a g e                                           %
%                                                                             %
%                                                                             %
%                                                                             %
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%  Method RegisterRLEImage adds attributes for the RLE image format to
%  the list of supported formats.  The attributes include the image format
%  tag, a method to read and/or write the format, whether the format
%  supports the saving of more than one frame to the same file or blob,
%  whether the format supports native in-memory I/O, and a brief
%  description of the format.
%
%  The format of the RegisterRLEImage method is:
%
%      RegisterRLEImage(void)
%
*/
ModuleExport void RegisterRLEImage(void)
{
  MagickInfo
    *entry;

  entry=SetMagickInfo("RLE");
  entry->decoder=(DecoderHandler) ReadRLEImage;
  entry->magick=(MagickHandler) IsRLE;
  entry->adjoin=False;
  entry->description="Utah Run length encoded image";
  entry->module="RLE";
  entry->coder_class=UnstableCoderClass;
  (void) RegisterMagickInfo(entry);
}

/*
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%                                                                             %
%                                                                             %
%                                                                             %
%   U n r e g i s t e r R L E I m a g e                                       %
%                                                                             %
%                                                                             %
%                                                                             %
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%
%  Method UnregisterRLEImage removes format registrations made by the
%  RLE module from the list of supported formats.
%
%  The format of the UnregisterRLEImage method is:
%
%      UnregisterRLEImage(void)
%
*/
ModuleExport void UnregisterRLEImage(void)
{
  (void) UnregisterMagickInfo("RLE");
}
