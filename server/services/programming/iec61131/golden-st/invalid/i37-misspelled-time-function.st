PROGRAM MisspelledTimeFn
VAR
    Dwell : TIME := T#2s;
    Total : TIME;
END_VAR

Total := ADD_TIMES(Dwell, T#1s);

END_PROGRAM
