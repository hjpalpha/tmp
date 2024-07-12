'use strict'

const childProcess = require('child_process')
const chalk = require('chalk')
const dotenv = require('dotenv')
const dotenvExpand = require('dotenv-expand')
const fs = require('fs')
const winston = require('winston')
const child_process = require("child_process");


const appLoggerFilename = 'appLogger.log'
const commandLoggerFilename = 'commandLogger.log'
const appLogger = winston.createLogger({
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({filename: appLoggerFilename, options: {flags: 'w'}})
    ]
})

if (require.main === module) {
    main()
}

const commandLogger = winston.createLogger({
    transports: [
        new winston.transports.File({filename: commandLoggerFilename, options: {flags: 'w'}})
    ]
})

async function main() {
    initializeEnvironment()
    /*
      exclude list for versions to be not installed
   */
    const excludeFromInstall = [
        {
            moduleName: 'sample1',
            versions: [
                '1.0.0',
                '1.0.6',
                '1.0.8',
                '1.0.9',
                '1.0.10',
                '1.0.11',
                '1.0.12',
                '1.0.15',
                '1.0.16',
                '1.0.18'
            ]
        },
        {
            moduleName: 'sample2',
            versions: [
                '2.14.2',
                '2.14.3',
                '2.14.4',
                '2.14.5',
                '2.14.6',
                '2.14.7',
                '2.14.8',
                '2.14.9',
                '2.14.17',
                '2.14.18',
                '2.14.19'
            ]
        }
    ]

    /*
      the maximum command line length in windows cmd is 8192 bytes.
      if the total command will be longer than a threshold, the command will be split into several separate commands
    */
    const commandSplitThreshold = 6184
    const batchSize = 5

    const startTime = new Date()
    console.log('Start-time: ' + startTime)
    const moduleVersions = getRequiredModules()
    console.log(chalk.green(`number of modules to process: ${moduleVersions.length}`))
    appLogger.info(`number of modules to process: ${moduleVersions.length}`)

    removeExcludedVersions(moduleVersions, excludeFromInstall)

    const commands = generateCommands(moduleVersions, commandSplitThreshold)
    /*
    for(const command of commands){
        appLogger.info(`current command: ${command}`)
    }
    */
    console.log(`number of commands to execute: ${commands.length}`)

    console.log('Which modules are to be loaded...')
    for (const moduleVersion of moduleVersions) {
        console.log(`module: ${moduleVersion.moduleName} - # of versions: ${moduleVersion.versions.length}`)
    }

    await processBatches(commands, batchSize)
    const endTime = new Date()

    // print the start and end time to get an impression of the overall duration
    console.log(chalk.greenBright.bold('Start-time: ' + startTime))
    console.log(chalk.greenBright.bold('End-time: ' + endTime))
}

function execute(command) {
    const p = childProcess.exec(command, {maxBuffer: 1024 * 2048})
    return new Promise((resolveFunc) => {
        p.stdout.on('data', (x) => {
            // process.stdout.write(chalk.green(x.toString()))
            commandLogger.info(x.toString())
        })
        p.stderr.on('data', (x) => {
            // process.stderr.write(chalk.red(x.toString()))
            commandLogger.info(x.toString())
        })
        p.on('exit', (code) => {
            resolveFunc(code)
        })
    })
}

async function processBatches(commands, batchSize) {
    const results = []
    for (let i = 0; i < commands.length; i += batchSize) {
        let batch = []
        try {
            batch = commands.slice(i, i + batchSize)

            console.log(`total number of install commands: ${commands.length} - commands executed: ${i} - remaining commands: ${commands.length - i}`)
            results.push(await processBatch(batch))
            console.log(chalk.green(`batch of ${batch.length} commands executed`))
        } catch (error) {
            console.log('Error executing batch: ' + batch)
            console.log('Error message: ' + error)
            exitProgram('Fatal program state! Exiting program!', -42)
        }
    }
    return results
}

// Function to process a batch of promises.
async function processBatch(batch) {
    try {
        const promises = []
        for (const command of batch) {
            const promise = execute(command)
            promises.push(promise)
        }
        const results = await Promise.all(promises)
        return results
    } catch (error) {
        console.log('Error executing batch: ' + batch)
        console.log('Error message: ' + error)
        exitProgram('Fatal program state! Exiting program!', -42)
    }
    return null;
}

function getRequiredModules() {
    const allRequiredModulesCacheFilename = './allRequiredModulesCache.json'
    let modules = []
    if (fs.existsSync(allRequiredModulesCacheFilename)) {
        modules = JSON.parse(fs.readFileSync(allRequiredModulesCacheFilename))
    } else {
        const requiredModulesFilename = './required_modules.json'
        const requiredModules = JSON.parse(fs.readFileSync(requiredModulesFilename))
        requiredModules.forEach((requiredModule) => {
            // console.log("Value: " + requiredModule + " - Index: " + index)
            let moduleName = requiredModule
            if (requiredModule.includes('@latest')) {
                const offset = requiredModule.indexOf('@latest')
                moduleName = requiredModule.substring(0, offset)
            }
            // console.log(moduleName);
            const command = 'npm view ' + moduleName + ' versions --json'
            console.log('Execute command: ' + command)
            const versions = childProcess.execSync(command)
            // console.log("Versions: " + versions);
            // eslint-disable-next-line new-cap
            let versionString = new Buffer.from(versions).toString()
            const versionsArr = JSON.parse(versionString)
            versionsArr.sort()
            versionString = JSON.stringify(versionsArr)
            // console.log("Versions from byte buffer: " + versionString);
            modules.push({moduleName, versions: JSON.parse(versionString)})
        })
        fs.writeFileSync(allRequiredModulesCacheFilename, JSON.stringify(modules))
    }
    return modules
}


function initializeEnvironment() {
    console.log('script is executed in directory: ' + __dirname)

    // load config from .env file and expand VSCODE_HOME variable when working with .env file
    const myEnv = dotenv.config()
    dotenvExpand.expand(myEnv)

    if (process.env.VSCODE_HOME == null || process.env.VSCODE_HOME.length === 0) {
        console.log(chalk.red('VSCODE_HOME not set!!!'))
        console.log(chalk.red('the script is not having the required environment'))

        exitProgram(chalk.red('fatal error, exiting...'), -42)
    }

    let pnpmConfigCommand = `pnpm config set store-dir ${process.env.XDG_STORE_HOME} && pnpm config get store-dir`
    console.log(chalk.blue('set store dir command: ') + pnpmConfigCommand)

    try {
        let result = childProcess.execSync(pnpmConfigCommand)
        console.log('Result pnpm config: ' + result)

        console.log('set pnpm registry to verdaccio')
        pnpmConfigCommand = 'pnpm config set registry http://localhost:4873'
        childProcess.execSync(pnpmConfigCommand)

        // due to parallel processing some fetches can lock each other
        console.log('set fetch-retries to 10')
        childProcess.execSync('pnpm config set fetch-retries 10 ')

        console.log('deleting pnpm_store, please wait: ' + process.env.XDG_STORE_HOME)
        result = childProcess.execSync(`rd /S/Q ${process.env.XDG_STORE_HOME} || echo error deleting pnpm_store dir.`)
        console.log('Result pnpm store deletion: ' + result)

        console.log('clear npm cache')
        const commandClearNpmCache = ' npm cache clear --force '
        childProcess.execSync(commandClearNpmCache)
    } catch (error) {
        console.log(chalk.red('Error executing command ') + pnpmConfigCommand)
        console.log(chalk.red('Error message: ') + error)
        exitProgram(chalk.red('Fatal program state! Exiting program!'), -42)
    }
}

function generateCommands(moduleVersions, commandSplitThreshold) {
    const commandPrefix = ' ECHO %DATE% %TIME% & '

    const commands = []
    for (const moduleVersion of moduleVersions) {
        let command = ' '
        let commandInstallModule = ' pnpm add --prefix ' + process.env.WORKING_DIRECTORY + ' '
        let commandPostfix = ' & ECHO FINISHED ' + moduleVersion.moduleName + ' AT %DATE% %TIME% > ' + process.env.WORKING_DIRECTORY + '\\' + moduleVersion.moduleName.replaceAll('/', '+') + '.log'

        command = commandPrefix + commandInstallModule

        // version can sometimes be a single value, so check for array
        if (Array.isArray(moduleVersion.versions)) {
            for (const version of moduleVersion.versions) {
                /*
                  check if current command is larger than the threshold
                  - push it to the array of commands to be executed
                  - start a new command
                */
                command += moduleVersion.moduleName + '@' + version + ' '
                if (command.length > commandSplitThreshold) {
                    command += commandPostfix

                    commands.push(command)
                    command = commandPrefix + commandInstallModule
                }
            }
            command += commandPostfix
            commands.push(command)
        } else {
            command += moduleVersion.moduleName + '@' + moduleVersion.versions + ' '
            command += commandPostfix
            commands.push(command)
        }
    }
    return commands
}

function exitProgram(text, returnCode) {
    console.log(text)
    process.exit(returnCode)
}

function removeExcludedVersions(fullList, excludeList) {
    return fullList.forEach(function (element) {
            // version can sometimes be a single value, so check for array
            if (Array.isArray(element.versions)) {
                element.versions = element.versions.filter((version) => {
                    const filter = (exclude) => exclude.moduleName === element.moduleName
                    const index = excludeList.findIndex(filter)
                    if (index > -1 && excludeList[index].versions.indexOf(version) > -1) {
                        console.log('Excluding from version list: ' + element.moduleName + ' version: ' + version)
                        return false
                    }
                    return true
                })
            }
        }
    )
}

