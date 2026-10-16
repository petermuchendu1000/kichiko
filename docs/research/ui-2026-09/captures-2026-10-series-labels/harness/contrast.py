def lin(c):
    c=c/255
    return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def L(h):
    h=h.lstrip('#'); r,g,b=(int(h[i:i+2],16) for i in (0,2,4))
    return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def ratio(a,b):
    la,lb=L(a),L(b)
    hi,lo=max(la,lb),min(la,lb)
    return (hi+0.05)/(lo+0.05)

light={'series-1':'#1452F0','series-2':'#B14800','series-3':'#00835B',
       'series-4':'#B05F8D','series-5':'#3299CD','series-6':'#C48600'}
dark ={'series-1':'#566BFF','series-2':'#F57825','series-3':'#37B98D',
       'series-4':'#E994C2','series-5':'#76D0FF','series-6':'#FFBA2F'}
print('%-10s %-9s %-9s' % ('token','on #FFFFFF','on #1A1C1F'))
worst_l=worst_d=99
for k in light:
    rl=ratio(light[k],'#FFFFFF'); rd=ratio(dark[k],'#1A1C1F')
    worst_l=min(worst_l,rl); worst_d=min(worst_d,rd)
    flag_l='OK ' if rl>=4.5 else ('3:1' if rl>=3 else 'FAIL')
    flag_d='OK ' if rd>=4.5 else ('3:1' if rd>=3 else 'FAIL')
    print('%-10s %6.2f %-5s %6.2f %-5s' % (k,rl,flag_l,rd,flag_d))
print()
print('worst light %.2f  worst dark %.2f   (4.5 needed for <18.5px text)' % (worst_l,worst_d))
print('text-3 light #656D78 on #FFFFFF: %.2f' % ratio('#656D78','#FFFFFF'))
print('text-2 dark  #CACED3 on #1A1C1F: %.2f' % ratio('#CACED3','#1A1C1F'))
