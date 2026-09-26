using System;

namespace CalculatorDemo
{
    public static class StringUtils
    {
        public static string DaoChuoi(string input)
        {
            if (input == null) throw new ArgumentNullException(nameof(input));
            var a = input.ToCharArray();
            Array.Reverse(a);
            return new string(a);
        }
    }
}
