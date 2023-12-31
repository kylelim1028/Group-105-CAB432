;
; Copyright (C) 2003-2023 GraphicsMagick Group
;
; This program is covered by multiple licenses, which are described in
; Copyright.txt. You should have received a copy of Copyright.txt with this
; package; otherwise see http://www.graphicsmagick.org/www/Copyright.html.
;

; #pragma option -v+
; #pragma verboselevel 4
; #define DEBUG 1

#define  public MagickDynamicPackage 1
#define  public QuantumDepth "8"
#define  public WIN64 1
#define  public InstallPerlMagick 0
;#define  public VC_2010
#define  public VC_2013

#include "inc\body.isx"

#ifdef Debug
  #expr SaveToFile(AddBackslash(SourcePath) + "gm-win64-Q8-dll.isp")
#endif
