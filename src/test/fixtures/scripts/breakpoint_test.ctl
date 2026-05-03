/**
 * breakpoint_test.ctl
 *
 * Minimal WinCC OA CTRL script used for E2E debugger tests.
 *
 * Known values when stopped at line 11 on first iteration (i=1):
 *   counter  = 0   (not yet updated on first pass through line 11)
 *   i        = 1
 *   message  = "hello"
 *
 * After the loop (line 16), counter = 1+2+3+4+5 = 15.
 */
main()
{
  int counter = 0;
  string message = "hello";

  for (int i = 1; i <= 5; i++)
  {
    counter = counter + i;      // line 11 — set breakpoint here
    delay(0, 400);              // 400 ms pause gives adapter time to process
  }

  DebugN("breakpoint_test result:", counter, message);
}
