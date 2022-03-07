import * as fs from 'fs'
import * as path from 'path'
import PQueue from 'p-queue';
import M3U8FileParser from 'm3u8-file-parser';
import { exec, spawn, execSync, spawnSync } from 'child_process'
import * as bitwise from 'bitwise';
const queue = new PQueue();
queue.on('add', () => {
  console.log(`Task is added.  Size: ${queue.size}  Pending: ${queue.pending}`);
});
queue.on('next', () => {
  console.log(`Task is completed.  Size: ${queue.size}  Pending: ${queue.pending}`);
});
queue.on('idle', () => {
  console.log(`Queue is idle.  Size: ${queue.size}  Pending: ${queue.pending}`);
});

// edit info here
// const prefix = '/home/vgm/Desktop';
const args = process.argv.slice(2)
const hardware = args[0];
const concurrency = parseInt(args[1].replace('concurrency=', '')) || 1;
const gpuNum = parseInt(args[2].replace('gpunum=', '')) || 1;
const startPoint = parseInt(args[3].replace('start=', ''));
const endPoint = parseInt(args[4].replace('end=', ''));
const fileType = 'video'; // 'audio';
// const itemSingle = 'videoSingle'; // 'audioSingle'
let VGM;
if (fileType === 'video') {
  VGM = 'VGMV';
  queue.concurrency = concurrency;
} else if (fileType === 'audio') {
  VGM = 'VGMA';
  queue.concurrency = 20;
}

const txtPath = `${__dirname}/database/${fileType}Single.txt`;
const originalTemp = `${__dirname}/database/tmp`;
const apiPath = `${__dirname}/database/API-convert/items/single`;
const mountedInput = `${__dirname}/database/mountedInput`;
const localOutPath = `${__dirname}/database/mountedOutput/converted`;
// const mountedEncrypted = `${prefix}/database/encrypted`;


// const renamedFolder = `${prefix}/database/renamed/${VGM}/01-Bài Giảng/Mục sư Nguyễn Thỉ/Năm 2017`; // /06-Phim
// const gateway = `https://cdn.vgm.tv/encrypted/${VGM}`;
// const warehousePath = 'VGM-Origin:vgmorigin/warehouse';

const originalPath = 'VGM-Origin:vgmorigin/warehouse'; // from onedrive: 'VGM-Movies:' --- from origin: 'VGM-Origin:vgmorigin/origin';
const convertedPath = 'VGM-Converted:vgmencrypted/encrypted';
// edit info end


interface FileInfo {
  pid: string,
  location: string,
  name: string,
  size: number,
  duration: string,
  qm: string,
  url: string,
  hash: string,
  isVideo: boolean,
  dblevel: number
}


// exec command
const downloadLocal = async (filePath) => {
  if (originalPath.includes('Movies')) {
    filePath = filePath.replace(/\//, '');
  };

  console.log('downloading local: ', `"${originalPath}${filePath}"`, `"${originalTemp}"`);
  return new Promise((resolve) => {
    const rclone = spawn('rclone', ['copy', '--progress', `${originalPath}${filePath}`, `${originalTemp}`]);
    rclone.stdout.on('data', async (data) => {
      console.log(`rclone download stdout: ${data}`);
    });
    rclone.stderr.on('data', async (data) => {
      console.log(`Stderr: ${data}`);
    });
    rclone.on('close', async (code) => {
      console.log(`download local successfull with code:`, code);
      resolve('done');
    })
  });
}

// const upWarehouse = async (renamedPath, destination) => {
//   console.log('uploading warehouse: ', `"${renamedPath}"`, `"${warehousePath}${destination}/"`);
//   return new Promise((resolve) => {
//     const rclone = spawn('rclone', ['copy', '--progress', `${renamedPath}`, `${warehousePath}${destination}/`]);
//     rclone.stdout.on('data', async (data) => {
//       console.log(`rclone upload stdout: ${data}`);
//     });
//     rclone.stderr.on('data', async (data) => {
//       console.log(`Stderr: ${data}`);
//     });
//     rclone.on('close', async (code) => {
//       console.log(`upload warehouse successfully with code:`, code);
//       resolve('done');
//     })
//   });
// }

const removeOldConverted = async (fileLocation) => {
  console.log('uploading converted file', `${convertedPath}${fileLocation}/`);
  return new Promise((resolve) => {
    const rclone = spawn('rclone', ['delete', '--progress', `${convertedPath}${fileLocation}/`]);
    rclone.stdout.on('data', async (data) => {
      console.log(`rclone removeOldConverted stdout: ${data}`);
    });
    rclone.stderr.on('data', async (data) => {
      console.log(`Stderr: ${data}`);
    });
    rclone.on('close', async (code) => {
      console.log(`rclone removeOldConverted done with code:`, code);
      resolve('done');
    })
  });
}

const upConverted = async (outPath, fileLocation) => {
  console.log('uploading converted file', `${outPath}/`, `${convertedPath}${fileLocation}/`);
  return new Promise((resolve) => {
    const rclone = spawn('rclone', ['copy', '--progress', `${outPath}/`, `${convertedPath}${fileLocation}/`]);
    rclone.stdout.on('data', async (data) => {
      console.log(`rclone upconvert stdout: ${data}`);
    });
    rclone.stderr.on('data', async (data) => {
      console.log(`Stderr: ${data}`);
    });
    rclone.on('close', async (code) => {
      console.log(`Upload converted file done with code:`, code);
      resolve('done');
    })
  });
}

const checkMP4 = async (tmpPath, fType) => {
  console.log('checking downloaded file', `${tmpPath}`);
  return new Promise(async (resolve) => {
    let info;
    try {
      info = await execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpPath}"`, { encoding: 'utf8' });
    } catch (error) {
      await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\n${tmpPath} --fileError cannot read`);
      resolve(false);
    }
    if (fType === 'video') {
      const jsonInfo = JSON.parse(info);
      const displayRatio = (jsonInfo.streams[0].width / jsonInfo.streams[0].height).toFixed(2);
      console.log(jsonInfo.streams[0].codec_long_name, displayRatio);
      // await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\n${tmpPath} ${jsonInfo.streams[0].codec_long_name} ${displayRatio}`);
      if (jsonInfo.streams[0].codec_long_name === 'MPEG-4 part 2' || displayRatio === (4 / 3).toFixed(2)) {
        const tmpName = path.parse(tmpPath).name;
        const mp4Tmp = tmpPath.replace(tmpName, `${tmpName}1`);
        await execSync(`mv "${tmpPath}" "${mp4Tmp}"`);
        console.log(mp4Tmp, tmpPath);
        const gpuIndex = Math.floor(Math.random() * gpuNum);
        const mp4 = spawn('ffmpeg', ['-vsync', '0', '-hwaccel_device', `${gpuIndex}`, '-i', `${mp4Tmp}`, '-c:v', 'h264_nvenc', '-filter:v', 'pad=width=max(iw\\,ih*(16/9)):height=ow/(16/9):x=(ow-iw)/2:y=(oh-ih)/2', '-c:a', 'copy', `${tmpPath}`]);
        // ffmpeg -vsync 0 -i '/home/vgm/Desktop/test.mp4' -c:v h264_nvenc -c:a aac '/home/vgm/Desktop/test2.mp4'
        mp4.stdout.on('data', async (data) => {
          console.log(`converting to mp4 stdout: ${data}`);
        });
        mp4.stderr.on('data', async (data) => {
          console.log(`Stderr: ${data}`);
        });
        mp4.on('close', async (code) => {
          console.log(`Converted to mp4 done with code:`, code);
          await fs.unlinkSync(mp4Tmp);
          resolve(true);
        })
      } else {
        console.log('mp4 h264 file ok');
        resolve(true);
      }
    } else {
      console.log('mp3 file ok');
      resolve(true);
    }
  });
}

const convertFile = async (file: string, fType: string, fURL: string) => {
  console.log('convertFile args:', file, fType, fURL);

  return new Promise((resolve) => {
    let fileInfo: FileInfo = { pid: '', location: '', name: '', size: 0, duration: '', qm: '', url: '', hash: '', isVideo: false, dblevel: 0 };
    // let metaData: any = [];
    // get file Info
    // metaData = execSync(`ffprobe -v quiet -select_streams v:0 -show_entries format=filename,duration,size,stream_index:stream=avg_frame_rate -of default=noprint_wrappers=1 "${file}"`, { encoding: "utf8" }).split('\n');
    // Then run ffmpeg to start convert
    // const duration_stat: string = metaData.filter(name => name.includes("duration=")).toString();
    // const duration: number = parseFloat(duration_stat.replace(/duration=/g, ''));
    // const minutes: number = Math.floor(duration / 60);
    // fileInfo.duration = `${minutes}:${Math.floor(duration) - (minutes * 60)}`;
    // fileInfo.size = parseInt(metaData.filter(name => name.includes("size=")).toString().replace('size=', ''));

    // const nameExtPath = files[index].match(/[\w\-\_\(\)\s]+\.[\w\S]{3,4}$/gi).toString();
    // fileInfo.name = nameExtPath.replace(/\.\w+/g, '');
    // fileInfo.name = path.parse(file).name;

    // read file.ini for name (instant code)
    // fileInfo.name = vName;
    // process filename
    // const nonVietnamese = nonAccentVietnamese(vName);
    // fileInfo.url = `${pItem.url}.${nonVietnamese.toLowerCase().replace(/[\W\_]/g, '-').replace(/-+-/g, "-")}`;
    // fileInfo.location = `${pItem.location}/${nonVietnamese.replace(/\s/g, '')}`;
    const filePath = fURL.replace(/\./g, '/')
    const outPath = `${localOutPath}/${filePath}`;
    // fileInfo.isVideo = pItem.isVideo;
    // fileInfo.pid = pItem.id;
    // fileInfo.dblevel = pItem.dblevel + 1;
    // console.log(fileInfo, 'start converting ffmpeg');
    const bashScript = hardware === 'cpu' ? 'ffmpeg-cpu.sh' : hardware === 'gpu' ? 'ffmpeg-gpu.sh' : hardware === 'hybrid' ? 'ffmpeg-hybrid.sh' : '';
    const gpuIndex = Math.floor(Math.random() * gpuNum);
    console.log(`'bash', [${bashScript}, "${file}", "${outPath}",  ${fType}, ${gpuIndex}]`);
    const conversion = spawn('bash', [bashScript, `"${file}"`, `"${outPath}"`, fType, gpuIndex.toString()]);

    conversion.stdout.on('data', async (data) => {
      console.log(`conversion stdout: ${data}`);
    });

    conversion.stderr.on('data', async (data) => {
      console.log(`Stderr: ${data}`);
    });

    conversion.on('close', async (code) => {
      console.log('converted file done with code:', code);
      // encrypt m3u8 key
      try {
        // get iv info
        const reader = new M3U8FileParser();
        let keyPath: string = fType === 'audio' ? `${outPath}/128p.m3u8` : `${outPath}/480p.m3u8`;
        const segment = await fs.readFileSync(keyPath, { encoding: 'utf-8' });
        reader.read(segment);
        const m3u8 = reader.getResult();
        const secret = `VGM-${m3u8.segments[0].key.iv.slice(0, 6).replace("0x", "")}`;
        // get buffer from key and iv
        const code = Buffer.from(secret);
        const key: Buffer = await fs.readFileSync(`${outPath}/key.vgmk`);
        const encrypted = bitwise.buffer.xor(key, code, false);
        await fs.writeFileSync(`${outPath}/key.vgmk`, encrypted, { encoding: 'binary' });
        console.log('Encrypt key file done');
        // // upload converted to s3 instant code
        // await removeOldConverted(upConvertedPath);
        // // upload converted folder
        // let upConvertedPath: string = fType === 'audio' ? `/VGMA/${fURL.replace(/\./g, '\/')}` : `/VGMV/${fURL.replace(/\./g, '\/')}`;
        // await upConverted(outPath, upConvertedPath);
        // await fs.rmdirSync(outPath, { recursive: true });
        // console.log('removed converted folder');
        resolve('done');

      } catch (error) {
        console.log('error:', error);
      }

    });
  });
}


// const checkFileExists = async (vName: string, pUrl, fType) => {
//   return new Promise((resolve) => {
//     // process filename
//     const nonVietnamese = nonAccentVietnamese(vName);
//     const api = `${pUrl}.${nonVietnamese.toLowerCase().replace(/[\W\_]/g, '-').replace(/-+-/g, "-")}`;
//     const fileUrl = api.replace(/\./g, '/');
//     let quality;
//     if (fType === 'video') quality = '480'; else quality = '128';
//     // // check m3u8 url
//     const url = `${gateway}/${fileUrl}/${quality}p.m3u8`; // if video 480p.m3u8 audio 128p.m3u8
//     // // check thumb url
//     // const url = `${gateway}/${fileUrl}/${quality}/7.jpg`;
//     // console.log('checkURL curl --silent --head --fail', url);
//     exec(`curl --silent --head --fail ${url}`, async (error, stdout, stderr) => {
//       if (error) {
//         console.log('file exist:', false);
//         await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\n${url} --fileMissing`);
//         resolve(false)
//       };
//       if (stderr) console.log('stderr', stderr);
//       if (stdout) {
//         console.log('file exist:', true);
//         await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\n${url} --fileExist`);
//         resolve(true);
//       };
//     });
//   });
// }


// Rewrite vietnamese function
function nonAccentVietnamese(str) {
  //     We can also use this instead of from line 11 to line 17
  //     str = str.replace(/\u00E0|\u00E1|\u1EA1|\u1EA3|\u00E3|\u00E2|\u1EA7|\u1EA5|\u1EAD|\u1EA9|\u1EAB|\u0103|\u1EB1|\u1EAF|\u1EB7|\u1EB3|\u1EB5/g, "a");
  //     str = str.replace(/\u00E8|\u00E9|\u1EB9|\u1EBB|\u1EBD|\u00EA|\u1EC1|\u1EBF|\u1EC7|\u1EC3|\u1EC5/g, "e");
  //     str = str.replace(/\u00EC|\u00ED|\u1ECB|\u1EC9|\u0129/g, "i");
  //     str = str.replace(/\u00F2|\u00F3|\u1ECD|\u1ECF|\u00F5|\u00F4|\u1ED3|\u1ED1|\u1ED9|\u1ED5|\u1ED7|\u01A1|\u1EDD|\u1EDB|\u1EE3|\u1EDF|\u1EE1/g, "o");
  //     str = str.replace(/\u00F9|\u00FA|\u1EE5|\u1EE7|\u0169|\u01B0|\u1EEB|\u1EE9|\u1EF1|\u1EED|\u1EEF/g, "u");
  //     str = str.replace(/\u1EF3|\u00FD|\u1EF5|\u1EF7|\u1EF9/g, "y");
  //     str = str.replace(/\u0111/g, "d");
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");

  str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "A");
  str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "E");
  str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "I");
  str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "O");
  str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "U");
  str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "Y");
  str = str.replace(/Đ|Ð/g, "D");
  // Some system encode vietnamese combining accent as individual utf-8 characters
  str = str.replace(/\u0300|\u0301|\u0303|\u0309|\u0323/g, ""); // Huyền sắc hỏi ngã nặng 
  str = str.replace(/\u02C6|\u0306|\u031B/g, ""); // Â, Ê, Ă, Ơ, Ư
  // str = str.replace(/-+-/g, "-"); //thay thế 2- thành 1- 
  return str;
}



const processFile = async (file: string, fType: string) => {
  return new Promise(async (resolve) => {

    const nonVietnamese = nonAccentVietnamese(file);
    const fAPI = `${nonVietnamese.replace(/.*VGMV\//, '').toLowerCase().replace(/\//g, '.').replace(/(?!\.)[\W\_]/g, '-').replace(/-+-/g, "-").replace(/\.mp4/, '')}`;
    const fileExist = fs.existsSync(`${apiPath}/${fAPI}.json`);
    if (fileExist) {
      const originalFile = file;

      // // download from s3 to local
      // await downloadLocal(originalFile);
      // const localOriginPath = `${originalTemp}/${path.parse(originalFile).base}`;
      // // mounted s3 to localOriginPath
      const localOriginPath = `${mountedInput}/${file.replace(/.*VGMV\//, '')}`;

      if (fs.existsSync(localOriginPath)) {
        console.log(localOriginPath);
        // check and convert mp4 to m3u8
        const fileOk = await checkMP4(localOriginPath, fType); // audio dont need check MP4
        if (fileOk) {
          // convert and up encrypted and database
          let fStat: string;
          const checkNonSilence = await execSync(`ffmpeg -i "${localOriginPath}" 2>&1 | grep Audio | awk '{print $0}' | tr -d ,`, { encoding: 'utf8' });
          if (checkNonSilence) fStat = fType; else fStat = 'videoSilence';
          await convertFile(localOriginPath, fStat, fAPI);
          // // remove downloaded file when done
          // await fs.unlinkSync(localOriginPath);
          resolve(fAPI);
        } else {
          await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\nbroken|${file}`);
          resolve('done');
        }
      } else {
        resolve(false);
      }
    } else {
      resolve(false);
    }
  })
};


const main = async () => {
  try {
    // start script here
    const raw = fs.readFileSync(txtPath, { encoding: 'utf8' });
    if (raw) {
      let list = raw.split('\n');
      list.pop();
      console.log('total files', list.length);
      const listLength = endPoint ? endPoint : list.length;

      for (let i = startPoint; i < listLength; i++) { // list.length or endPoint
        (async () => {
          queue.add(async () => {
            const result = await processFile(list[i], fileType);
            var today = new Date();
            var date = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
            var time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
            var dateTime = date + '-' + time;
            //   console.log('processed files', i, dateTime);
            if (result) {
              await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\n${i}|${result}|${dateTime}`);
            } else {
              await fs.appendFileSync(`${__dirname}/database/${fileType}-converted-count.txt`, `\n${i}|notfound|${list[i]}`);
            }
          });
        })();
      }
    }
  } catch (error) {
    console.log(error);
  }
}

main();