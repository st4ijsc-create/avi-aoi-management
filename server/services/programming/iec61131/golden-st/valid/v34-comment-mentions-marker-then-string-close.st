(* Reviewer repro (fix round 2): this comment mentions (* in its text and is closed here *)
PROGRAM CommentThenStringMarker
VAR
    Hint  : STRING := 'end a comment with *)';
    Lamp  : BOOL;
    Count : INT;
END_VAR

Lamp := TRUE;
Count := Count + 1;
Hint := 'end a comment with *)';

END_PROGRAM
