// if this line were code it would be broken: IF x THEN
(* Multi-line comment mentioning for, while, repeat and END_IF / END_FOR
   and even an unbalanced VAR or two: VAR VAR VAR *)
PROGRAM CommentTorture
VAR
    Lamp  : BOOL;   // turn on if the door is open
    Door  : BOOL;   (* while door open, for safety keep lamp on *)
    Label : STRING := 'IF Door THEN END_WHILE (* not a comment *)';
END_VAR
/* block comment: FOR i := 1 TO 10 DO */
IF Door THEN   // for the operator
    Lamp := TRUE;  (* end_if would go here if *)
ELSE
    Lamp := FALSE;
END_IF;
Label := 'it$'s $'quoted$' and // not a comment';
END_PROGRAM
