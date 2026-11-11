export function contourInterval(span,metersPerPixel){
 const desired=Math.max(1,Math.min(Math.max(1,span)/16,Math.max(.01,metersPerPixel)*8));
 const decade=10**Math.floor(Math.log10(desired));
 return [1,2,5,10].find(step=>step*decade>=desired)*decade;
}
// Thin out text independently of the actual contour interval so labels remain
// readable even when the color range spans many closely spaced contours.
export function contourLegendLevels(min,max,interval,height){
 if(!(max>min&&interval>0&&height>0))return [];
 const count=(max-min)/interval,capacity=Math.max(1,Math.floor(height/28));
 const desired=Math.max(1,count/capacity),power=10**Math.floor(Math.log10(desired));
 const stride=[1,2,5,10].find(value=>value*power>=desired)*power;
 const labelInterval=interval*stride,levels=[];
 for(let index=Math.ceil(min/labelInterval);index*labelInterval<=max&&levels.length<30;index++){
  const elevation=index*labelInterval,position=(max-elevation)/(max-min);
  if(position*height<20||(1-position)*height<20)continue;
  levels.push({elevation,position});
 }
 return levels;
}
