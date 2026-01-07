/**
 * @file Unit tests for no-iife-in-anonymous ESLint rule.
 */
import { RuleTester } from "eslint";
import rule from "./no-iife-in-anonymous.js";

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

ruleTester.run("no-iife-in-anonymous", rule, {
  valid: [
    {
      code: `
        // IIFE at top level is allowed
        (() => {
          console.log('hello');
        })();
      `,
    },
    {
      code: `
        // IIFE in named function is allowed
        function namedFunc() {
          (() => {
            console.log('hello');
          })();
        }
      `,
    },
    {
      code: `
        // IIFE in named function expression is allowed
        const namedFunc = function named() {
          (() => {
            console.log('hello');
          })();
        };
      `,
    },
    {
      code: `
        // Regular function call in anonymous function is allowed
        const fn = () => {
          someFunction();
        };
      `,
    },
    {
      code: `
        // Nested named functions with IIFE
        function outer() {
          function inner() {
            (() => {
              console.log('hello');
            })();
          }
        }
      `,
    },
  ],
  invalid: [
    {
      code: `
        // IIFE inside arrow function
        const fn = () => {
          (() => {
            console.log('hello');
          })();
        };
      `,
      errors: [{ messageId: "noIifeInAnonymous" }],
    },
    {
      code: `
        // IIFE inside anonymous function expression
        const fn = function() {
          (() => {
            console.log('hello');
          })();
        };
      `,
      errors: [{ messageId: "noIifeInAnonymous" }],
    },
    {
      code: `
        // IIFE using function expression inside arrow function
        const fn = () => {
          (function() {
            console.log('hello');
          })();
        };
      `,
      errors: [{ messageId: "noIifeInAnonymous" }],
    },
    {
      code: `
        // Nested anonymous functions with IIFE
        const outer = () => {
          const inner = () => {
            (() => {
              console.log('hello');
            })();
          };
        };
      `,
      errors: [{ messageId: "noIifeInAnonymous" }],
    },
    {
      code: `
        // IIFE in callback
        someArray.forEach(() => {
          (() => {
            console.log('item');
          })();
        });
      `,
      errors: [{ messageId: "noIifeInAnonymous" }],
    },
    {
      code: `
        // IIFE in anonymous function passed as argument
        setTimeout(function() {
          (() => {
            console.log('timeout');
          })();
        }, 100);
      `,
      errors: [{ messageId: "noIifeInAnonymous" }],
    },
  ],
});
