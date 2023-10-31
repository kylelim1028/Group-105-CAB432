################################################################################
# Check for the OpenGL and GLUT libraries.
################################################################################

if (JAS_ENABLE_OPENGL)
	set(OpenGL_GL_PREFERENCE GLVND)
	find_package(OpenGL ${JAS_REQUIRED})
	message("OpenGL library found: ${OPENGL_FOUND}")
else()
	set(OPENGL_FOUND false)
endif()
if (JAS_ENABLE_OPENGL AND OPENGL_FOUND)
	set(JAS_HAVE_OPENGL 0)
	message("OpenGL include directory: ${OPENGL_INCLUDE_DIR}")
	message("OpenGL libraries: ${OPENGL_LIBRARIES}")
	find_package(GLUT ${JAS_REQUIRED})
	message("GLUT library found: ${GLUT_FOUND}")
	if (GLUT_FOUND)
		message("GLUT include directory: ${GLUT_INCLUDE_DIR}")
		message("GLUT libraries: ${GLUT_LIBRARIES}")
		set(CMAKE_REQUIRED_INCLUDES ${GLUT_INCLUDE_DIR})
		check_include_files(GL/glut.h JAS_HAVE_GL_GLUT_H)
		check_include_files(glut.h JAS_HAVE_GLUT_H)
		if (JAS_HAVE_GL_GLUT_H OR JAS_HAVE_GLUT_H)
			set(JAS_HAVE_OPENGL 1)
			include_directories(${GLUT_INCLUDE_DIR} ${OPENGL_INCLUDE_DIR})
		else()
			message(WARNING "The header files GL/glut.h and glut.h both appear to be missing.")
			message(WARNING "Disabling OpenGL.")
		endif()
	endif()
	# On some systems (e.g., Fedora 21), there is a bug in the cmake code
	# that detects GLUT libraries.  The following ugliness is a workaround for 
	# this problem.
	if (NOT GLUT_Xmu_LIBRARY OR NOT GLUT_Xmi_LIBRARY)
		if (NOT GLUT_Xmu_LIBRARY)
			set(GLUT_Xmu_LIBRARY "")
			message(WARNING "Clearing bogus value for GLUT_Xmu_LIBRARY.")
			message(WARNING "Your version of CMake may be buggy.")
		endif()
		if (NOT GLUT_Xmi_LIBRARY)
			set(GLUT_Xmi_LIBRARY "")
			message(WARNING "Clearing bogus value for GLUT_Xmi_LIBRARY.")
			message(WARNING "Your version of CMake may be buggy.")
		endif()
		set(GLUT_LIBRARIES "${GLUT_glut_LIBRARY}")
	endif()
else()
	set(JAS_HAVE_OPENGL 0)
	set(OPENGL_INCLUDE_DIR "")
	set(OPENGL_LIBRARIES "")
	set(GLUT_INCLUDE_DIR "")
	set(GLUT_LIBRARIES "")
endif()
