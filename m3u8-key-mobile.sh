#!/usr/bin/env bash

# Declare variable for inputpath and outputpath, remove quotation marks
# $1 inpath, $2 filetype $3 keyHash
inPath=$(sed -e 's/^"//' -e 's/"$//' <<<"$1")
cd $inPath || return
if [ $2 == 'audio' ]; then
	mkdir -p $inPath/128p
	rename 's/data//' *.vgmx
	ls | grep '\.vgmx$' | xargs -I '{}' mv {} $inPath/128p
	sed -i -e 's/^data/128p\//g' $inPath/128p.m3u8
fi

if [ $3 ]; then
	keyPath="http://ipfs-sgp.hjm.bid/ipfs/${3}"
	for f in $(find ${inPath} -type f -name '*.m3u8'); do
		if [ $(basename ${f%.*}) == 'playlist' ]; then
			newPath="${f%.*}-mb.${f##*.}"
			cp ${f} ${newPath}
			sed -i 's/1080p.m3u8/1080p-mb.m3u8/g' "${newPath}" &&
				sed -i 's/720p.m3u8/720p-mb.m3u8/g' "${newPath}" &&
				sed -i 's/480p.m3u8/480p-mb.m3u8/g' "${newPath}" &&
				sed -i 's/360p.m3u8/360p-mb.m3u8/g' "${newPath}"
		elif [ $(basename ${f%.*}) == '1080p' ] || [ $(basename ${f%.*}) == '720p' ] || [ $(basename ${f%.*}) == '480p' ]  || [ $(basename ${f%.*}) == '360p' ] || [ $(basename ${f%.*}) == '128p' ]; then
			newPath="${f%.*}-mb.${f##*.}"
			cp ${f} ${newPath}
			sed -i "s|key.vgmk|$keyPath|g" "${newPath}"
		fi
	done
fi
