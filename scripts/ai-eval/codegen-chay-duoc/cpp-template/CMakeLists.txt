# Khuon C++ cho bo do sinh-ma-chay-duoc. CMake tu tim MSVC qua registry nen KHONG can vcvars64
# trong shell — mot buoc it hon la mot cho it hong hon.
cmake_minimum_required(VERSION 3.20)
project(solbench CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(solbench sol.cpp)
