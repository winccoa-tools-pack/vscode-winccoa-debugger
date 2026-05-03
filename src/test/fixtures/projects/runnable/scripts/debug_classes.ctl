// debug_classes.ctl
// Manager -num 9   Mode: manual   Flags: -dbg CTRL_DEBUGBREAK
// CTRL class debugging: Shape (base), Circle (derived with inheritance)
#uses "classes/Shape"
#uses "classes/Circle"

main()
{
  Shape shapeInstant = Shape("Triangle", 3);
  Circle circleInstant = Circle("Circle", 0, 2.5);
  int counter = 0;
  string desc;
  float circleArea;
  DebugBreak();

  while (true)
  {
    desc = shapeInstant.describe();
    circleArea = circleInstant.area();
    counter++;
    delay(1);
  }
}
