// Circle.ctl — Derived class for class debugging E2E tests
#uses "classes/Shape"

class Circle : Shape
{
  private float m_radius;

  public Circle(string n = "", int s = 0, float r = 0.0)
  {
    m_name  = n;
    m_sides = s;
    m_radius = r;
  }

  public float getRadius()
  {
    return m_radius;
  }

  public float area()
  {
    float a = 3.14159 * m_radius * m_radius;
    return a;
  }
};
