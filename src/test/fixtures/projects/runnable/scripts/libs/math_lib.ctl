// libs/math_lib.ctl — second library for multi-lib BP tests.
// Used by call_multi_libs.ctl via #uses "math_lib".
// BP_MATH_LINE = 7  (int result = a * b, first line of multiply_two body)

int multiply_two(int a, int b)
{
  int result = a * b;   // line 7 — BP_MATH_LINE
  return result;
}
