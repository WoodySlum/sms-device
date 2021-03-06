import {RawModem, DefaultSerialPort, ModemOptions} from 'raw-modem';
import {IModemDriver} from '../IModemDriver';
import Rx = require('rxjs/Rx');

export class WavecomModemDriver implements IModemDriver{
    constructor(){

    }

    _getModemOptions(configFile:string){
        let modemOptions = new ModemOptions();
        modemOptions.autoOpen = false;
        modemOptions.baudRate = 115200;
        modemOptions.deviceName = configFile;
        
        return modemOptions;
    }

    identify(configFile:string): Rx.Observable<string>{
        return Rx.Observable.create(s =>{

            let serialPort = new DefaultSerialPort();

            let modemOptions = this._getModemOptions(configFile);
            let modem = new RawModem(serialPort);

            let result = {
                deviceName: configFile,
                model: '',
                manufacturer: '',
                firmware: '',
                imei:'',
                sim_imsi:''
            }

            let resultToString = resultObject =>{
                let resultString = `
Device               : ${result.deviceName}
Manufacturer         : ${result.manufacturer}
Model                : ${result.model}
Firmware             : ${result.firmware}
IMEI                 : ${result.imei}
SIM IMSI             : ${result.sim_imsi}                                            
                `;

                return resultString;
            }
            let isModemOpened = false;
            modem.open(modemOptions)
                .flatMap(() => {
                    isModemOpened = true;
                    return modem.send('AT+CGMM\r')
                })
                .flatMap((response)=>{
                    let responseTrimmed = response.trim().replace('AT+CGMM', '');
                    result.model = responseTrimmed.trim();
                    return modem.send('AT+CGMI\r')
                })
                .flatMap((response)=>{
                    let responseTrimmed = response.trim().replace('AT+CGMI', '');
                    result.manufacturer = responseTrimmed.trim();
                    return modem.send('AT+CGMR\r')
                })                
                .flatMap((response)=>{
                    let responseTrimmed = response.trim().replace('AT+CGMR', '');
                    result.firmware = responseTrimmed.trim()
                    return modem.send('AT+CGSN\r')
                })                
                .flatMap((response)=>{
                    let responseTrimmed = response.trim().replace('AT+CGSN', '');
                    result.imei = responseTrimmed.trim();
                    return modem.send('AT+CIMI\r')
                })                
                .map((response)=>{
                    let responseTrimmed = response.trim().replace('AT+CIMI', '');
                    result.sim_imsi = responseTrimmed.trim();

                    return response;
                })           
                .finally(()=> {
                    if(isModemOpened){
                        modem.close().subscribe(()=>{});
                    }
                })                                                                      
                .subscribe(response =>{
                    
                    let resultString = resultToString(result);

                    s.next(resultString);

                }, err => s.error(err), () => s.complete())
        })
    }

    readAllSms(configFile:string): Rx.Observable<string>{
        return Rx.Observable.create(s =>{

            let serialPort = new DefaultSerialPort();

            let modemOptions = this._getModemOptions(configFile);

            let modem = new RawModem(serialPort);
            
            let isModemOpened = false;
            modem.open(modemOptions)
                .flatMap(() => {
                    isModemOpened = true;
                    return modem.send('AT+CMGF=1\r');
                })
                .flatMap((response)=>{
                    return modem.send('AT+CMGL="ALL"\r')
                })
                .finally(()=> {
                    if(isModemOpened){
                        modem.close().subscribe(()=>{});
                    }
                })                                                                      
                .subscribe(response =>{
                    s.next(response);
                    
                }, err => s.error(err), () => s.complete())
        })    
    }

    deleteAllSms(configFile:string, startLocation:number, endLocation:number):Rx.Observable<void>{
        return Rx.Observable.create(s =>{

            let serialPort = new DefaultSerialPort();

            let modemOptions = this._getModemOptions(configFile);

            let modem = new RawModem(serialPort);
            let isModemOpened = false;
            modem.open(modemOptions)
                .flatMap(() => {
                    isModemOpened = true;
                    return Rx.Observable.range(startLocation, (endLocation - startLocation) + 1);
                })
                .flatMap((messageIndex) =>{
                    let command = `AT+CMGD=${messageIndex},0\r`;
                    return modem.send(command);
                })
                .skipWhile((value, index) =>{
                    return index !== (endLocation - startLocation);
                })
                .finally(()=> {
                    if(isModemOpened){
                        modem.close().subscribe(()=>{});
                    }
                })                                                                      
                .subscribe(response =>{
                    s.next();                    
                }, err => s.error(err), () => s.complete())            
        })    
    }

    sendSms(configFile:string, destinationPhone:string, message: string): Rx.Observable<void>{
        return Rx.Observable.create(s =>{

            let serialPort = new DefaultSerialPort();

            let modemOptions = this._getModemOptions(configFile);

            let modem = new RawModem(serialPort);
            let isModemOpened = false;
            modem.open(modemOptions)
                .flatMap(() => {
                    isModemOpened = true;
                    return modem.send('AT+CSCS="GSM"\r')
                })
                .flatMap(() => modem.send('AT+CSMP=1,173,0,7\r'))
                .flatMap(() => modem.send('AT+CMGF=1\r'))
                .flatMap(response =>{
                    return modem.send(`AT+CMGS="${destinationPhone}"\r`, 
                        (buffer:any, subscriber: Rx.Subscriber<string>)=>{

                            let responseString = buffer.toString().trim();
                            if(responseString === ">"){
                                subscriber.next("");
                                subscriber.complete();
                            }
                        })
                })                             
                .flatMap(response =>{
                    return modem.send(`${message}\x1A\r`)
                })                         
                .finally(()=> {
                    if(isModemOpened){
                        modem.close().subscribe(()=>{});
                    }
                })                                                                      
                .subscribe(response =>{
                    s.next();
                }, 
                err => s.error(err), 
                () => s.complete());
        })    
    }    

    getUSSDWithCallback(configFile:string, ussdCommand:string, callback:(modem:RawModem, responseString:string) => Rx.Observable<string>):Rx.Observable<string>{
        return Rx.Observable.create(s =>{
            let serialPort = new DefaultSerialPort();

            let modemOptions = this._getModemOptions(configFile);
            modemOptions.commandTimeout = 8000;

            let modem = new RawModem(serialPort);
            let isModemOpened = false;
            modem.open(modemOptions)
                .flatMap(()=>{
                    isModemOpened = true;
                    let completeString = '';
                    return modem.send(`AT+CUSD=1,"${ussdCommand}"\r`, (buffer:any, subscriber: Rx.Subscriber<string>) =>{
                        completeString += buffer.toString();
                        
                        console.log('completeString:', completeString);

                        let trimmedCompleteString = completeString.trim();

                        if(trimmedCompleteString.endsWith('",0') 
                            || (trimmedCompleteString.endsWith('+CUSD: 4'))
                            || (trimmedCompleteString.includes('+CUSD:') && trimmedCompleteString.endsWith('",15'))){
                            
                            subscriber.next(trimmedCompleteString);
                            subscriber.complete();
                        }
                    });
                })
                .flatMap((response) => {
                    return callback(modem, response);
                })                          
                .finally(()=> {
                    if(isModemOpened){
                        modem.close().subscribe(()=>{});
                    }
                })                                                                      
                .subscribe(r =>{
                    s.next(r);
                }, err => s.error(err), ()=>{
                    s.complete();
                }) 
        })        
    }

    getUSSD(configFile:string, ussdCommand:string):Rx.Observable<string>{
        return this.getUSSDWithCallback(configFile, ussdCommand, (modem:RawModem, responseString:string) => {
            return modem.close()
                .flatMap(() => Rx.Observable.from([responseString]));
        })
    }
}