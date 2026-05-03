// libs/sub_math.ctl — library in sub-project for sub-project BP tests.
// Called from runnable/scripts/call_subproject_lib.ctl via #uses "sub_math".
// BP_SUB_LIB_LINE = 7  (int result = a * b + 1)

int sub_multiply_add(int a, int b)
{
  int result = a * b + 1;   // line 7 — BP_SUB_LIB_LINE
  return result;
}
