PROGRAM FindFirstEmpty
VAR
    Slots     : ARRAY[1..10] OF BOOL;
    I         : INT;
    FirstFree : INT := -1;
END_VAR

I := 1;
WHILE I <= 10 DO
    IF NOT Slots[I] THEN
        FirstFree := I;
        EXIT;
    END_IF;
    I := I + 1;
END_WHILE;

END_PROGRAM
