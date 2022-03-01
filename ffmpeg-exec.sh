#!/usr/bin/env bash

# Declare variable for inputpath and outputpath, remove quotation marks
inPath=$(sed -e 's/^"//' -e 's/"$//' <<<"$1")
outPath=$(sed -e 's/^"//' -e 's/"$//' <<<"$2")
fileType=$3
varStreamMap=""
if [[ $fileType == 'video' ]]; then
	varStreamMap="v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p"
elif [[ $fileType == 'videoSilence' ]]; then
	varStreamMap="v:0,name:1080p v:1,name:720p v:2,name:480p"
fi
# Define bitrate here
((rate1080 = 3600))
((rate720 = 1500))
((rate480 = 900))
((rate360 = 600))
((buf1080 = rate1080 * 2))
((buf720 = rate720 * 2))
((buf480 = rate480 * 2))
((buf360 = rate360 * 2))

# Define convert function
ffmpegVideoGPU() {
	ffmpeg -v quiet -progress pipe:1 -stats_period 0.5 -vsync 0 -hwaccel cuvid -c:v h264_cuvid -i "${inPath}" \
		-filter_complex \
		"[0:v]split=3[v1][v2][v3]; \
[v1]scale_npp=w=1920:h=1080:force_original_aspect_ratio=decrease[v1out]; \
[v2]scale_npp=w=1280:h=720:force_original_aspect_ratio=decrease[v2out]; \
[v3]scale_npp=w=854:h=480:force_original_aspect_ratio=decrease[v3out]" \
		-map "[v1out]" -c:v h264_nvenc -preset:v p7 -tune:v hq -rc:v vbr -cq:v 19 -b:v:0 "$rate1080"K -maxrate:v:0 "$rate1080"K -bufsize:v:0 "$buf1080"K -g 48 -sc_threshold 0 -keyint_min 48 \
		-map "[v2out]" -c:v h264_nvenc -preset:v p7 -tune:v hq -rc:v vbr -cq:v 19 -b:v:1 "$rate720"K -maxrate:v:1 "$rate720"K -bufsize:v:1 "$buf720"K -g 48 -sc_threshold 0 -keyint_min 48 \
		-map "[v3out]" -c:v h264_nvenc -preset:v p7 -tune:v hq -rc:v vbr -cq:v 19 -b:v:2 "$rate480"K -maxrate:v:2 "$rate480"K -bufsize:v:2 "$buf480"K -g 48 -sc_threshold 0 -keyint_min 48 \
		-map "0:a?" -c:a:0 aac -b:a:0 192k -ac 2 \
		-map "0:a?" -c:a:1 aac -b:a:1 128k -ac 2 \
		-map "0:a?" -c:a:2 aac -b:a:2 96k -ac 2 \
		-f hls \
		-hls_time 3 \
		-hls_key_info_file file.keyinfo \
		-hls_playlist_type vod \
		-hls_flags independent_segments \
		-hls_segment_type mpegts \
		-strftime_mkdir 1 \
		-var_stream_map "${varStreamMap}" \
		-master_pl_name playlist.m3u8 \
		-hls_segment_filename %v/content%01d.vgmx "$outPath"/%v.m3u8 &&
		printf '#EXT-X-STREAM-INF:BANDWIDTH=765600,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"\n360p.m3u8\n' >>"$outPath"/playlist.m3u8
}

ffmpegVideoCPU() {
	ffmpeg -v quiet -progress pipe:1 -stats_period 0.5 -vsync 0 -i "${inPath}" \
		-vf scale=w=640:h=360:force_original_aspect_ratio=decrease \
		-c:v h264 -b:v "$rate360"K -maxrate "$rate360"K -bufsize "$buf360"K \
		-c:a aac -b:a 96k -ac 2 \
		-crf 28 \
		-preset slow -g 48 -sc_threshold 0 -keyint_min 48 \
		-f hls \
		-hls_time 3 \
		-hls_key_info_file file.keyinfo \
		-hls_playlist_type vod \
		-hls_flags independent_segments \
		-hls_segment_type mpegts \
		-strftime_mkdir 1 \
		-hls_segment_filename 360p/content%01d.vgmx \
		"$outPath"/360p.m3u8
}

ffmpegThumbnailGPU() {
	ffmpeg -v quiet -y -ss 00:00:10 -hwaccel cuvid -c:v h264_cuvid -threads 1 -skip_frame nokey -i "${inPath}" \
		-vf select='not(mod(n\,5))',scale_npp=1920:1080,hwdownload,format=nv12,fps=1/7 -r 0.1 -frames:v 7 -vsync vfr -q:v 2 -vcodec libwebp -lossless 0 -compression_level 6 -qscale 100 "$outPath"/1080/%01d.webp \
		-vf select='not(mod(n\,5))',scale_npp=1280:720,hwdownload,format=nv12,fps=1/7 -r 0.1 -frames:v 7 -vsync vfr -q:v 2 -vcodec libwebp -lossless 0 -compression_level 6 -qscale 100 "$outPath"/720/%01d.webp \
		-vf select='not(mod(n\,5))',scale_npp=854:480,hwdownload,format=nv12,fps=1/7 -r 0.1 -frames:v 7 -vsync vfr -q:v 2 -vcodec libwebp -lossless 0 -compression_level 6 -qscale 100 "$outPath"/480/%01d.webp \
		-vf select='not(mod(n\,5))',scale_npp=640:360,hwdownload,format=nv12,fps=1/7 -r 0.1 -frames:v 7 -vsync vfr -q:v 2 -vcodec libwebp -lossless 0 -compression_level 6 -qscale 100 "$outPath"/360/%01d.webp \
		-vf select='not(mod(n\,5))',scale_npp=426:240,hwdownload,format=nv12,fps=1/7 -r 0.1 -frames:v 7 -vsync vfr -q:v 2 -vcodec libwebp -lossless 0 -compression_level 6 -qscale 100 "$outPath"/240/%01d.webp
}

ffmpegAudioCPU() {
	ffmpeg -progress pipe:1 -stats_period 0.5 -v quiet -vsync 0 -hwaccel cuvid -c:v h264_cuvid -i "${inPath}" \
		-map 0:a -c:a aac -b:a:0 192k -ac 2 \
		-f hls \
		-hls_time 5 \
		-preset slow \
		-hls_key_info_file file.keyinfo \
		-hls_playlist_type vod \
		-hls_flags independent_segments \
		-hls_segment_type mpegts \
		-strftime_mkdir 1 \
		-hls_segment_filename 128p/%01d.vgmx \
		"$outPath"/128p.m3u8
}
# Main function start here
# Timer start
((start = $(date +%s)))
mkdir -p "$outPath" && cd "$outPath" &&
	openssl rand 16 >key.vgmk &&
	echo key.vgmk >file.keyinfo &&
	echo key.vgmk >>file.keyinfo &&
	openssl rand -hex 16 >>file.keyinfo &&
	if [[ $fileType == 'video' || $fileType == 'videoSilence' ]]; then
		mkdir -p "$outPath"/{1080,720,480,360,240,1080p,720p,480p,360p} &&
			ffmpegVideoGPU &
		ffmpegVideoCPU &
		ffmpegThumbnailGPU
	else
		mkdir -p "$outPath"/128p && ffmpegAudioCPU
	fi
rm file.keyinfo
# Timer end
((end = $(date +%s) - $start))
echo "Total converted time: $(date -u -d @${end} +"%T")"
