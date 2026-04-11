// libs/nested_lib.ctl — library that calls another library (debugger_lib).
// Tests nested #uses depth: call_multi_libs → nested_lib → debugger_lib.
// BP_NESTED_LINE = 9  (int added = add_two_integers(a, b))

#uses "debugger_lib"

int add_then_double(int a, int b)
{
  int added = add_two_integers(a, b);   // line 9 — BP_NESTED_LINE (calls debugger_lib)
  int doubled = added * 2;
  return doubled;
}
