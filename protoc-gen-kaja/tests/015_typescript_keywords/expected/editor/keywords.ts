/**
 * Test TypeScript reserved keywords as field names
 */
export interface TypeScriptKeywords {
    const: string;
    let: string;
    var: string;
    function: string;
    class: string;
    interface: string;
    type: string;
    enum: string;
    namespace: string;
    module: string;
    extends: string;
    implements: string;
    static: string;
    private: string;
    public: string;
    protected: string;
    readonly: string;
    async: string;
    await: string;
    yield: string;
    return: string;
    break: string;
    continue: string;
    throw: string;
    try: string;
    catch: string;
    finally: string;
    if: string;
    else: string;
    switch: string;
    case: string;
    default: string;
    for: string;
    while: string;
    do: string;
    new: string;
    this: string;
    super: string;
    import: string;
    export: string;
    from: string;
    as: string;
    in: string;
    of: string;
    typeof: string;
    instanceof: string;
    void: string;
    null: string;
    undefined: string;
    true: string;
    false: string;
    delete: string;
    with: string;
    debugger: string;
}

/**
 * Test keywords as message names
 */
export interface const$ {
    value: string;
}

export interface let$ {
    value: string;
}

export interface class$ {
    value: string;
}

/**
 * Test keywords as enum names
 */
export enum const_enum {
    CONST_UNKNOWN = 0,
    CONST_VALUE = 1,
}

export enum interface_type {
    INTERFACE_UNKNOWN = 0,
    INTERFACE_VALUE = 1,
}
