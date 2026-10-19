# Khuôn C++ của bộ đo ngẫu nhiên. ĐỪNG SỬA (tệp được bảo vệ).
# Mỗi tệp tests/*.cpp thành MỘT tệp chạy (tên = tên tệp), liên kết MỌI src/*.cpp, và là MỘT test của ctest.
# CMake tự dò MSVC qua registry — không cần vcvars64.
# Chạy test: cmake -S . -B _b  →  cmake --build _b  →  ctest --test-dir _b
cmake_minimum_required(VERSION 3.20)
project(bai CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
  add_compile_options(/utf-8 /EHsc /W3 /permissive- /Zc:__cplusplus)
endif()
enable_testing()
file(GLOB NGUON CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/src/*.cpp)
file(GLOB TEST CONFIGURE_DEPENDS ${CMAKE_SOURCE_DIR}/tests/*.cpp)
foreach(t ${TEST})
  get_filename_component(ten ${t} NAME_WE)
  add_executable(${ten} ${t} ${NGUON})
  target_include_directories(${ten} PRIVATE ${CMAKE_SOURCE_DIR}/src ${CMAKE_SOURCE_DIR}/tests)
  add_test(NAME ${ten} COMMAND ${ten})
endforeach()
