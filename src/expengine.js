/* 
    expengine.js
    validate and modify reduced esprima AST
*/

const __is = (i, className) => i.type == className
const __isin = (i, cl) => ([false].concat(cl)).reduce((p, clName) => p || __is(i, clName))
const OPR_PREC = {'+': 0, '-': 0, '*': 1, '/': 1}

class ExpressionEngine {
    STD_FUNCTIONS = ['date', 'str', 'number', 'date_add', 'round', 'int']
    AGGR_FUNCTIONS = ['sum', 'min', 'max', 'avg', 'count']

    constructor (FieldNames = []) {
        this.fieldNames =  FieldNames
        this.datasetTypeName =  ''
        this.onCheckVar =  (id) => true
        this.onCheckAttribute =  (id, key) => true
        this.onCheckAggregateMember =  (aggrfname, id, key) => true
        this.errFlag =  false
        this.errMessage =  undefined
        this.varNames =  []
        this.attrNames =  []
        this.contextAttrNames =  []
    }

    throwEx (synPart, t)  {
        // throw Error(`Error in ${synPart}. Location line ${t.loc.start.line} col ${t.loc.start.column}`)
        this.errFlag = true
        this.errMessage = `Error in ${synPart}. Location line ${t.loc.start.line} col ${t.loc.start.column}`
        return true
    }

    _body (t) {
        this.errFlag = false
        this.errMessage = undefined
        this.varNames = []
        this.attrNames = []
        this.contextAttrNames = []
        return Array.isArray(t) && t.length == 1 && this._expr(t[0]) || this.throwEx('function body', t)
    }

    _expr (t) {
        return __is(t, 'ExpressionStatement') && (this._cexpression(t.expression) || this.throwEx('expression', t))
    }

    _cexpression (t) {
        return this._cbinop(t) || this._negative(t) || this._ifexp(t) || this._funccall(t) || this._element(t)
    }

    _cbinop (t) {
        var res = __is(t, 'BinaryExpression') && (
            (this._cexpression(t.left) && ['+', '-', '*', '/'].indexOf(t.operator) >= 0 && this._cexpression(t.right)) ||
                this.throwEx(`binary expression. operator: ${t.operator}`, t)
        )
        if (res) {
            t.left.parent = t; t.right.parent = t
        }
        return res
    }

    _negative (t) {
        return __is(t, 'UnaryExpression') && (
            (t.operator == '-' && this._cexpression(t.argument)) || this.throwEx('negative', t)
        )
    } 

    _ifexp (t) {
        return __is(t, 'ConditionalExpression') && (
            (this._cexpression(t.consequent) && this._bexpression(t.test) && this._cexpression(t.alternate)) ||  
            this.throwEx('ifexp', t)
        )
    }

    _bexpression(t) {
        return this._boolop(t) || this._compare(t) || this._negation(t)
    }

    _boolop (t) {
        return __is(t, 'LogicalExpression') && (
            (t.operator == '&&' || t.operator == '||')) || this.throwEx('boolop', t)
    }

    _compare (t) {
        return (
            __is(t, 'BinaryExpression') && ['>', '>=', '<', '<=', '==', '!='].indexOf(t.operator) >= 0 && 
            (this._cexpression(t.left) && this._cexpression(t.right) || this.throwEx('compare', t))
        ) 
    }

    _negation (t) {
        return __is(t, 'UnaryExpression') && (t.operator == '!') && (this._bexpression(t) || this.throwEx('negation', t))
    }

    _funccall (t) {
        return __is(t, 'CallExpression') && (
            (
                this._funcname(t.callee) && [true].concat(t.arguments).reduce((v, x) => v && this._cexpression(x))
            ) ||
            (
                this._aggrfuncname(t.callee) && this.isValidAggrFuncCall(t.callee.name, t.arguments)
            ) || 
            this.throwEx('funccall', t)
        )
    }

    _funcname (t) {
        return __is(t, 'Identifier') && (this.STD_FUNCTIONS.indexOf(t.name) >= 0)
    }

    _aggrfuncname (t) {
        return __is(t, 'Identifier') && (this.AGGR_FUNCTIONS.indexOf(t.name) >= 0)

    }

    _element (t) {
        return __is(t, 'Identifier') && (this.isValidIdentifier(t) || this.throwEx(`Unknown variable "${t.name}"`, t)) || 
            this._attribute(t) || __is(t, 'Literal') && (typeof(t.value) == 'number' || typeof(t.value) == 'string')
    }

    _attribute (t) {
        return __is(t, 'MemberExpression') && (
                (__is(t.object, 'Identifier') && __is(t.property, 'Identifier') && 
                    this.isValidAttribute(t.object.name, t.property.name)) || this.throwEx('attribute', t)
            )
    }

    isValidIdentifier (t) {
        var res = (this.onCheckVar && this.onCheckVar(t.name)) || (this.fieldNames.indexOf(t.name) >= 0)
        if (res) {
            if (this.varNames.indexOf(t.name) < 0) {
                this.varNames.push(t.name)
            }
        }
        return res
    }

    isValidAttribute (id, key) {
        var res = (this.onCheckAttribute && this.onCheckAttribute(id, key))
        if (res)
            this.attrNames.push({id, key})
        return true
    }

    isValidAggrFuncCall (funcName, args) {
        var t = args.length == 1 ? args[0] : undefined
        var res = t &&
            __is(t, 'MemberExpression') &&
            __is(t.object, 'Identifier') && 
            __is(t.property, 'Identifier') && 
            this.onCheckAggregateMember(funcName, t.object.name, t.property.name)
        if (res)
            this.contextAttrNames.push({id: t.object.name, key: t.property.name})
        return res
    }

    /* expression generator function, for execution in eval() */

    gens_body (t) {return this.gens_expr(t[0])}

    gens_expr (t) {return this.gens_cexpression(t.expression)}

    gens_cexpression (t) {
        return this.gens_cbinop(t) || this.gens_negative(t) || this.gens_ifexp(t) || this.gens_funccall(t) || this.gens_element(t)
    }

    gens_cbinop (t) {
        return __is(t, 'BinaryExpression') ?
            (
                (t.parent && __is(t.parent, 'BinaryExpression') && OPR_PREC[t.parent.operator] > OPR_PREC[t.operator]) ?
                    `(${this.gens_cexpression(t.left)} ${t.operator} ${this.gens_cexpression(t.right)})` :
                    `${this.gens_cexpression(t.left)} ${t.operator} ${this.gens_cexpression(t.right)}`
            ) :
            undefined
    }

    gens_negative (t) {
        return __is(t, 'UnaryExpression') && t.operator == '-' ?
            (
                __is(t.argument, 'Literal') || __is(t.argument, 'Identifier') ? 
                    `-${this.gens_cexpression(t)}` : `-(${this.gens_cexpression(t)})`
            ) :
            undefined
    }

    gens_ifexp (t) {
        return __is(t, 'ConditionalExpression') ?
            (
                `(\r\n\t(${this.gens_bexpression(t.test)}) ?\r\n\t(${this.gens_cexpression(t.consequent)}) : \r\n\t(${this.gens_cexpression(t.alternate)}))`
            ) :
            undefined
    }

    gens_funccall (t) {
        return __is(t, 'CallExpression') ?
            (
                this.STD_FUNCTIONS.indexOf(t.callee.name) >= 0 ?
                    (
                        `row.stdf_${t.callee.name}(` + t.arguments.map((v) => this.gens_cexpression(v)).join(', ') + ')'
                    ) 
                    :
                this.AGGR_FUNCTIONS.indexOf(t.callee.name) >= 0 ?
                    (
                        `row.getAggr('${t.callee.name}', '${t.arguments[0].object.name}', '${t.arguments[0].property.name}')`
                    ) 
                    :
                undefined
            )    
            :
            undefined
    }

    gens_element (t) {
        return __is(t, 'Identifier') && `row.getField('${t.name}')` ||
            __is(t, 'MemberExpression') && `row.getLink('${t.object.name}', '${t.property.name}')` ||
            __is(t, 'Literal') && `${t.raw}` || 
            undefined
    }


}

export default ExpressionEngine




