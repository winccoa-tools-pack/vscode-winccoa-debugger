// Shape.ctl — Base class for class debugging E2E tests

class Shape
{
  protected string m_name;
  protected int    m_sides;

  public Shape(string n = "", int s = 0)
  {
    m_name  = n;
    m_sides = s;
  }

  public string getName()
  {
    return m_name;
  }

  public int getSides()
  {
    return m_sides;
  }

  public string describe()
  {
    string result = m_name + " has " + m_sides + " sides";
    return result;
  }
};
